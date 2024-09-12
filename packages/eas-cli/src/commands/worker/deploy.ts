import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'node:fs';
import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags, EASEnvironmentFlag } from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import { createProgressTracker } from '../../utils/progress';
import * as WorkerAssets from '../../worker/assets';
import {
  assignWorkerDeploymentAliasAsync,
  assignWorkerDeploymentProductionAsync,
  getSignedDeploymentUrlAsync,
} from '../../worker/deployment';
import { UploadParams, batchUploadAsync, uploadAsync } from '../../worker/upload';

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
}

interface RawDeployFlags {
  'non-interactive': boolean;
  environment?: string;
  json: boolean;
  prod: boolean;
  alias?: string;
  id?: string;
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
    Log.warn('EAS Worker Deployments are in beta and subject to breaking changes.');

    const { flags: rawFlags } = await this.parse(WorkerDeploy);
    const flags = this.sanitizeFlags(rawFlags);

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkerDeploy, flags);

    const { projectId, exp } = await getDynamicPrivateProjectConfigAsync();
    const distPath = path.resolve(projectDir, 'dist');

    let distServerPath: string | null;
    let distClientPath: string;
    if (exp.web?.output === 'static') {
      distClientPath = distPath;
      distServerPath = null;
      if (!(await isDirectory(distClientPath))) {
        throw new Error(
          `No "dist/" folder found. Prepare your project for deployment with "npx expo export"`
        );
      }

      logDeploymentType('static');
    } else if (exp.web?.output === 'server') {
      distClientPath = path.resolve(distPath, 'client');
      distServerPath = path.resolve(distPath, 'server');
      if (!(await isDirectory(distClientPath))) {
        throw new Error(
          `No "dist/client/" folder found. Prepare your project for deployment with "npx expo export"`
        );
      } else if (!(await isDirectory(distServerPath))) {
        throw new Error(
          `No "dist/server/" folder found. Prepare your project for deployment with "npx expo export"`
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

    async function uploadTarballAsync(tarPath: string): Promise<any> {
      const uploadUrl = await getSignedDeploymentUrlAsync(graphqlClient, exp, {
        appId: projectId,
        deploymentIdentifier: flags.deploymentIdentifier,
      });

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
      const manifest = await WorkerAssets.createManifestAsync({
        environment: flags.environment,
        projectDir,
        projectId,
      }, graphqlClient);
      assetMap = await WorkerAssets.createAssetMapAsync(distClientPath);
      tarPath = await WorkerAssets.packFilesIterableAsync(
        emitWorkerTarballAsync({
          assetMap,
          manifest,
        })
      );

      progress.text = 'Creating deployment';
      deployResult = await uploadTarballAsync(tarPath);
      progress.succeed('Created deployment');
    } catch (error: any) {
      progress.fail('Failed to create deployment');
      throw error;
    }

    await uploadAssetsAsync(assetMap, deployResult.uploads);

    let deploymentAliasUrl: string | null = null;
    if (flags.aliasName) {
      progress = ora(chalk`Assigning alias {bold ${flags.aliasName}} to deployment`).start();
      try {
        const workerAlias = await assignWorkerDeploymentAliasAsync({
          graphqlClient,
          appId: projectId,
          deploymentId: deployResult.id,
          aliasName: flags.aliasName,
        });
        deploymentAliasUrl = workerAlias.url;

        // Only stop the spinner when not promoting to production
        if (!flags.isProduction) {
          progress.succeed(chalk`Assigned alias {bold ${flags.aliasName}} to deployment`);
        }
      } catch (error: any) {
        progress.fail(chalk`Failed to assign {bold ${flags.aliasName}} alias to deployment`);
        throw error;
      }
    }

    let deploymentProductionUrl: string | null = null;
    if (flags.isProduction) {
      try {
        if (!flags.aliasName) {
          progress = ora(chalk`Promoting deployment to {bold production}`).start();
        } else {
          progress.text = chalk`Promoting deployment to {bold production}`;
        }

        const workerProdAlias = await assignWorkerDeploymentProductionAsync({
          graphqlClient,
          appId: projectId,
          deploymentId: deployResult.id,
        });
        deploymentProductionUrl = workerProdAlias.url;

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

    const expoBaseDomain = process.env.EXPO_STAGING ? 'staging.expo' : 'expo';

    logDeployment({
      expoDashboardUrl: `https://${expoBaseDomain}.dev/projects/${projectId}/serverless/deployments`,
      deploymentUrl: `https://${deployResult.fullName}.${expoBaseDomain}.app`,
      aliasedUrl: deploymentAliasUrl,
      productionUrl: deploymentProductionUrl,
    });
  }

  private sanitizeFlags(flags: RawDeployFlags): DeployFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
      isProduction: !!flags.prod,
      aliasName: flags.alias?.trim().toLowerCase(),
      deploymentIdentifier: flags.id?.trim(),
    };
  }
}

type LogDeploymentOptions = {
  expoDashboardUrl: string;
  deploymentUrl: string;
  aliasedUrl?: string | null;
  productionUrl?: string | null;
};

function logDeployment(options: LogDeploymentOptions): void {
  Log.addNewLineIfNone();
  Log.log(`🎉 Your deployment is ready`);
  Log.addNewLineIfNone();

  const fields: FormatFieldsItem[] = [
    { label: 'Dashboard', value: options.expoDashboardUrl },
    { label: 'Deployment URL', value: options.deploymentUrl },
  ];

  if (options.aliasedUrl) {
    fields.push({ label: 'Alias URL', value: options.aliasedUrl });
  }
  if (options.productionUrl) {
    fields.push({ label: 'Production URL', value: options.productionUrl });
  }

  const lastUrlField = fields[fields.length - 1];
  lastUrlField.value = chalk.cyan(lastUrlField.value);

  Log.log(formatFields(fields));

  if (!options.productionUrl) {
    Log.addNewLineIfNone();
    Log.log('🚀 When you are ready to deploy to production:');
    Log.log(chalk`  $ eas deploy {bold --prod}`);
  }
}

/** Log the detected of Expo export */
function logDeploymentType(type: 'static' | 'server'): void {
  Log.log(chalk`{dim > output: ${type}}`);
}
