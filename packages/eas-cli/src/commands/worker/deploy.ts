import { format as formatTimeAgo } from '@expo/timeago.js';
import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'node:fs';
import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag, EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EnvironmentVariableEnvironment,
  WorkerDeploymentAliasFragment,
} from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { createProgressTracker } from '../../utils/progress';
import * as WorkerAssets from '../../worker/assets';
import {
  assignWorkerDeploymentAliasAsync,
  assignWorkerDeploymentProductionAsync,
  getSignedDeploymentUrlAsync,
} from '../../worker/deployment';
import { UploadParams, batchUploadAsync, uploadAsync } from '../../worker/upload';
import {
  formatWorkerDeploymentJson,
  formatWorkerDeploymentTable,
  getDeploymentUrlFromFullName,
} from '../../worker/utils/logs';

const isDirectory = (directoryPath: string): Promise<boolean> =>
  fs.promises
    .stat(directoryPath)
    .then(stat => stat.isDirectory())
    .catch(() => false);

interface DeployFlags {
  nonInteractive: boolean;
  json: boolean;
  isProduction: boolean;
  aliasName?: string;
  environment?: EnvironmentVariableEnvironment;
  deploymentIdentifier?: string;
  exportDir: string;
}

interface RawDeployFlags {
  'non-interactive': boolean;
  environment?: string;
  json: boolean;
  prod: boolean;
  alias?: string;
  id?: string;
  'export-dir': string;
}

export default class WorkerDeploy extends EasCommand {
  static override description = 'Deploy your Expo web build';
  static override aliases = ['deploy'];
  static override usage = [chalk`deploy {dim [options]}`, `deploy --prod`];

  // TODO(@kitten): Keep command hidden until worker deployments are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    prod: Flags.boolean({
      aliases: ['production'],
      description: 'Create a new production deployment.',
      default: false,
    }),
    alias: Flags.string({
      description: 'Custom alias to assign to the new deployment.',
      helpValue: 'name',
    }),
    id: Flags.string({
      description: 'Custom unique identifier for the new deployment.',
      helpValue: 'xyz123',
    }),
    'export-dir': Flags.string({
      description: 'Directory where the Expo project was exported.',
      helpValue: 'dir',
      default: 'dist',
    }),
    environment: {
      ...EASEnvironmentFlag.environment,
      description: 'Use EAS secret variables matching the specified environment in the new deployment.',
    },
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(WorkerDeploy);
    const flags = this.sanitizeFlags(rawFlags);

    if (flags.json) {
      enableJsonOutput();
    }

    Log.warn('EAS Worker Deployments are in beta and subject to breaking changes.');

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkerDeploy, flags);

    const [{ projectId }, projectDist] = await Promise.all([
      getDynamicPrivateProjectConfigAsync(),
      resolveExportedProjectAsync(flags, projectDir),
    ]);

    logExportedProjectInfo(projectDist);

    async function* emitWorkerTarballAsync(params: {
      assetMap: WorkerAssets.AssetMap;
      manifest: WorkerAssets.Manifest;
    }): AsyncGenerator<WorkerAssets.FileEntry> {
      yield ['assets.json', JSON.stringify(params.assetMap)];
      yield ['manifest.json', JSON.stringify(params.manifest)];
      if (projectDist.type === 'server' && projectDist.serverPath) {
        const workerFiles = WorkerAssets.listWorkerFilesAsync(projectDist.serverPath);
        for await (const workerFile of workerFiles) {
          yield [`server/${workerFile.normalizedPath}`, workerFile.data];
        }
      }
    }

    async function uploadTarballAsync(tarPath: string, uploadUrl: string): Promise<any> {
      const { response } = await uploadAsync({
        url: uploadUrl,
        filePath: tarPath,
        compress: false,
        headers: {
          accept: 'application/json',
        },
      });
      if (response.status === 413) {
        throw new Error(
          'Upload failed! (Payload too large)\n' +
            `The files in "${path.relative(
              projectDir,
              projectDist.path
            )}" (at: ${projectDir}) exceed the maximum file size (10MB gzip).`
        );
      } else if (!response.ok) {
        throw new Error(`Upload failed! (${response.statusText})`);
      } else {
        const json = await response.json();
        if (!json.success || !json.result || typeof json.result !== 'object') {
          throw new Error(json.message ? `Upload failed: ${json.message}` : 'Upload failed!');
        }
        return json.result;
      }
    }

    async function uploadAssetsAsync(
      assetMap: WorkerAssets.AssetMap,
      uploads: Record<string, string>
    ): Promise<void> {
      if (typeof uploads !== 'object' || !uploads) {
        return;
      }

      // TODO(@kitten): Batch and upload multiple files in parallel
      const uploadParams: UploadParams[] = [];
      const assetPath = projectDist.type === 'server' ? projectDist.clientPath : projectDist.path;
      for await (const asset of WorkerAssets.listAssetMapFilesAsync(assetPath, assetMap)) {
        const uploadURL = uploads[asset.normalizedPath];
        if (uploadURL) {
          uploadParams.push({ url: uploadURL, filePath: asset.path });
        }
      }

      const progress = {
        total: uploadParams.length,
        pending: 0,
        percent: 0,
        transferred: 0,
      };

      const updateProgress = createProgressTracker({
        total: progress.total,
        message(ratio) {
          const percent = `${Math.floor(ratio * 100)}`;
          const details = chalk.dim(
            `(${progress.pending} Pending, ${progress.transferred} Completed, ${progress.total} Total)`
          );
          return `Uploading assets: ${percent.padStart(3)}% ${details}`;
        },
        completedMessage: 'Uploaded assets',
      });

      try {
        for await (const signal of batchUploadAsync(uploadParams)) {
          if ('response' in signal) {
            progress.pending--;
            progress.percent = ++progress.transferred / progress.total;
          } else {
            progress.pending++;
          }
          updateProgress({ progress });
        }
      } catch (error: any) {
        updateProgress({ isComplete: true, error });
        throw error;
      }
      updateProgress({ isComplete: true });
    }

    let assetMap: WorkerAssets.AssetMap;
    let tarPath: string;
    let deployResult: any;
    let progress = ora('Preparing project').start();

    try {
      const manifest = await WorkerAssets.createManifestAsync(
        {
          environment: flags.environment,
          projectDir,
          projectId,
        },
        graphqlClient
      );
      assetMap = await WorkerAssets.createAssetMapAsync(
        projectDist.type === 'server' ? projectDist.clientPath : projectDist.path
      );
      tarPath = await WorkerAssets.packFilesIterableAsync(
        emitWorkerTarballAsync({
          assetMap,
          manifest,
        })
      );

      const uploadUrl = await getSignedDeploymentUrlAsync(graphqlClient, {
        appId: projectId,
        deploymentIdentifier: flags.deploymentIdentifier,
        // NOTE(cedric): this function might ask the user for a dev-domain name,
        // when that happens, no ora spinner should be running.
        onSetupDevDomain: () => progress.stop(),
        nonInteractive: flags.nonInteractive,
      });

      progress.start('Creating deployment');
      deployResult = await uploadTarballAsync(tarPath, uploadUrl);
      progress.succeed('Created deployment');
    } catch (error: any) {
      progress.fail('Failed to create deployment');
      throw error;
    }

    await uploadAssetsAsync(assetMap, deployResult.uploads);

    let deploymentAlias: null | Awaited<ReturnType<typeof assignWorkerDeploymentAliasAsync>> = null;
    if (flags.aliasName) {
      progress = ora(chalk`Assigning alias {bold ${flags.aliasName}} to deployment`).start();
      try {
        deploymentAlias = await assignWorkerDeploymentAliasAsync({
          graphqlClient,
          appId: projectId,
          deploymentId: deployResult.id,
          aliasName: flags.aliasName,
        });

        // Only stop the spinner when not promoting to production
        if (!flags.isProduction) {
          progress.succeed(chalk`Assigned alias {bold ${flags.aliasName}} to deployment`);
        }
      } catch (error: any) {
        progress.fail(chalk`Failed to assign {bold ${flags.aliasName}} alias to deployment`);
        throw error;
      }
    }

    let deploymentProdAlias: null | Awaited<
      ReturnType<typeof assignWorkerDeploymentProductionAsync>
    > = null;
    if (flags.isProduction) {
      try {
        if (!flags.aliasName) {
          progress = ora(chalk`Promoting deployment to {bold production}`).start();
        } else {
          progress.text = chalk`Promoting deployment to {bold production}`;
        }

        deploymentProdAlias = await assignWorkerDeploymentProductionAsync({
          graphqlClient,
          appId: projectId,
          deploymentId: deployResult.id,
        });

        progress.succeed(
          !flags.aliasName
            ? chalk`Promoted deployment to {bold production}`
            : chalk`Promoted deployment to {bold production} with alias {bold ${flags.aliasName}}`
        );
      } catch (error: any) {
        progress.fail('Failed to promote deployment to production');
        throw error;
      }
    }

    if (flags.json) {
      printJsonOnlyOutput(
        formatWorkerDeploymentJson({
          projectId,
          deployment: {
            deploymentIdentifier: deployResult.id,
            url: getDeploymentUrlFromFullName(deployResult.fullName),
          },
          aliases: [deploymentAlias].filter(Boolean) as WorkerDeploymentAliasFragment[],
          production: deploymentProdAlias,
        })
      );
      return;
    }

    Log.addNewLineIfNone();
    Log.log(`🎉 Your deployment is ready`);
    Log.addNewLineIfNone();
    Log.log(
      formatWorkerDeploymentTable({
        projectId,
        deployment: {
          deploymentIdentifier: deployResult.id,
          url: getDeploymentUrlFromFullName(deployResult.fullName),
        },
        aliases: [deploymentAlias].filter(Boolean) as WorkerDeploymentAliasFragment[],
        production: deploymentProdAlias,
      })
    );

    if (!deploymentProdAlias) {
      Log.addNewLineIfNone();
      Log.log('🚀 When you are ready to deploy to production:');
      Log.log(chalk`  $ eas deploy {bold --prod}`);
    }
  }

  private sanitizeFlags(flags: RawDeployFlags): DeployFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
      isProduction: !!flags.prod,
      aliasName: flags.alias?.trim().toLowerCase(),
      deploymentIdentifier: flags.id?.trim(),
      exportDir: flags['export-dir'],
    };
  }
}

async function resolveExportedProjectAsync(
  flags: DeployFlags,
  projectDir: string
): Promise<
  | { type: 'static'; modifiedAt: Date; path: string }
  | { type: 'server'; modifiedAt: Date; path: string; serverPath: string; clientPath: string }
> {
  const exportPath = path.join(projectDir, flags.exportDir);
  const serverPath = path.join(exportPath, 'server');
  const clientPath = path.join(exportPath, 'client');

  const [hasServerPath, hasClientPath, modifiedAt] = await Promise.all([
    isDirectory(serverPath),
    isDirectory(clientPath),
    fs.promises.stat(exportPath).then(stat => stat.mtime),
  ]);

  if (hasServerPath && hasClientPath) {
    return { type: 'server', path: exportPath, modifiedAt, serverPath, clientPath };
  }

  return { type: 'static', path: exportPath, modifiedAt };
}

function logExportedProjectInfo(
  project: Awaited<ReturnType<typeof resolveExportedProjectAsync>>
): void {
  const modifiedAgo = formatTimeAgo(project.modifiedAt);
  Log.log(chalk`{dim > Project export: ${project.type} - created ${modifiedAgo}}`);
}
