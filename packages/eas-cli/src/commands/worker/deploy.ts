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
      description: 'Create a new production deployment',
      default: false,
    }),
    alias: Flags.string({
      description: 'Custom alias to assign to the new deployment',
      helpValue: 'name',
    }),
    id: Flags.string({
      description: 'Custom unique identifier for the new deployment',
      helpValue: 'xyz123',
    }),
    'export-dir': Flags.string({
      description: 'Directory where the Expo project was exported',
      helpValue: 'dir',
      default: 'dist',
    }),
    // TODO(@kitten): Allow deployment identifier to be specified
    ...EasNonInteractiveAndJsonFlags,
    ...EASEnvironmentFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    // NOTE(cedric): `Log.warn` uses `console.log`, which is incorrect when running with `--json`
    // eslint-disable-next-line no-console
    console.warn(
      chalk.yellow('EAS Worker Deployments are in beta and subject to breaking changes.')
    );

    const { flags: rawFlags } = await this.parse(WorkerDeploy);
    const flags = this.sanitizeFlags(rawFlags);

    if (flags.json) {
      enableJsonOutput();
    }

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkerDeploy, flags);

    const { projectId, exp } = await getDynamicPrivateProjectConfigAsync();
    const distPath = path.join(projectDir, flags.exportDir);

    let distServerPath: string | null;
    let distClientPath: string;
    if (exp.web?.output === 'static') {
      distClientPath = distPath;
      distServerPath = null;
      if (!(await isDirectory(distClientPath))) {
        throw new Error(
          `No "${flags.exportDir}/" folder found. Prepare your project for deployment with "npx expo export"`
        );
      }

      logDeploymentType('static');
    } else if (exp.web?.output === 'server') {
      distClientPath = path.join(distPath, 'client');
      distServerPath = path.join(distPath, 'server');
      if (!(await isDirectory(distClientPath))) {
        throw new Error(
          `No "${flags.exportDir}/client/" folder found. Prepare your project for deployment with "npx expo export"`
        );
      } else if (!(await isDirectory(distServerPath))) {
        throw new Error(
          `No "${flags.exportDir}/server/" folder found. Prepare your project for deployment with "npx expo export"`
        );
      }

      logDeploymentType('server');
    } else {
      throw new Error(
        `Single-page apps are not supported. Ensure that app.json key "expo.web.output" is set to "server" or "static".`
      );
    }

    async function* emitWorkerTarballAsync(params: {
      assetMap: WorkerAssets.AssetMap;
      manifest: WorkerAssets.Manifest;
    }): AsyncGenerator<WorkerAssets.FileEntry> {
      yield ['assets.json', JSON.stringify(params.assetMap)];
      yield ['manifest.json', JSON.stringify(params.manifest)];
      if (distServerPath) {
        const workerFiles = WorkerAssets.listWorkerFilesAsync(distServerPath);
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
            `The files in "dist/server/" (at: ${distServerPath}) exceed the maximum file size (10MB gzip).`
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
      for await (const asset of WorkerAssets.listAssetMapFilesAsync(distClientPath, assetMap)) {
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
      assetMap = await WorkerAssets.createAssetMapAsync(distClientPath);
      tarPath = await WorkerAssets.packFilesIterableAsync(
        emitWorkerTarballAsync({
          assetMap,
          manifest,
        })
      );

      // NOTE(cedric): this function might ask the user for a dev-domain name,
      // when that happens, no ora spinner should be running.
      progress.stop();
      const uploadUrl = await getSignedDeploymentUrlAsync(graphqlClient, exp, {
        appId: projectId,
        deploymentIdentifier: flags.deploymentIdentifier,
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

/** Log the detected of Expo export */
function logDeploymentType(type: 'static' | 'server'): void {
  Log.log(chalk`{dim > output: ${type}}`);
}
