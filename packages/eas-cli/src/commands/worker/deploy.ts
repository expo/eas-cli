import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'node:fs';
import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { ora } from '../../ora';
import { createProgressTracker } from '../../utils/progress';
import * as WorkerAssets from '../../worker/assets';
import {
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
  prod: boolean;
}

interface RawDeployFlags {
  'non-interactive': boolean;
  json: boolean;
  prod?: boolean;
}

export default class WorkerDeploy extends EasCommand {
  static override description = 'deploy an Expo web build';
  static override aliases = ['deploy'];

  // TODO(@kitten): Keep command hidden until worker deployments are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    prod: Flags.boolean({
      description: 'Deploy to production',
      type: 'boolean',
    }),
    // TODO(@kitten): Allow deployment identifier to be specified
    ...EasNonInteractiveAndJsonFlags,
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
      Log.log('Detected "static" worker deployment');
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
      Log.log('Detected "server" worker deployment');
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
          return `Uploading client assets: ${percent.padStart(3)}% ${details}`;
        },
        completedMessage: 'Uploaded assets for serverless deployment',
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

    let progress = ora('Preparing worker upload');
    let assetMap: WorkerAssets.AssetMap;
    let tarPath: string;
    try {
      assetMap = await WorkerAssets.createAssetMapAsync(distClientPath);
      const manifest = await WorkerAssets.createManifestAsync(projectDir);
      tarPath = await WorkerAssets.packFilesIterableAsync(
        emitWorkerTarballAsync({
          assetMap,
          manifest,
        })
      );
    } catch (error: any) {
      progress.fail('Failed to prepare worker upload');
      throw error;
    }
    progress.succeed('Prepared worker upload');

    progress = ora('Creating worker deployment');
    let deployResult: any;
    try {
      deployResult = await uploadTarballAsync(tarPath);
    } catch (error: any) {
      progress.fail('Failed to create worker deployment');
      throw error;
    }
    progress.succeed('Created worker deployment');

    await uploadAssetsAsync(assetMap, deployResult.uploads);

    const expoBaseDomain = process.env.EXPO_STAGING ? 'staging.expo' : 'expo';
    const dashboardUrl = `https://${expoBaseDomain}.dev/projects/${projectId}/serverless/deployments`;

    if (!flags.prod) {
      logDeployment({
        dashboardUrl,
        deploymentUrl: `https://${deployResult.fullName}.${expoBaseDomain}.app`,
        isProduction: false,
      });
      return;
    }

    progress = ora('Assigning worker deployment to production');
    try {
      const workerProdAlias = await assignWorkerDeploymentProductionAsync({
        graphqlClient,
        appId: projectId,
        deploymentId: deployResult.id,
      });

      progress.succeed('Assigned worker deployment to production');

      logDeployment({
        dashboardUrl,
        deploymentUrl: workerProdAlias.url,
        isProduction: true,
      });
    } catch (error: any) {
      progress.fail('Failed to assign worker deployment to production');
      throw error;
    }
  }

  private sanitizeFlags(flags: RawDeployFlags): DeployFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
      prod: !!flags.prod,
    };
  }
}

function logDeployment({
  deploymentUrl,
  dashboardUrl,
  isProduction,
}: {
  deploymentUrl: string;
  dashboardUrl: string;
  isProduction: boolean;
}): void {
  Log.addNewLineIfNone();
  Log.log(`🎉 Your worker deployment is ready: ${deploymentUrl}`);
  Log.addNewLineIfNone();
  Log.log(`🔗 Manage on EAS: ${dashboardUrl}`);

  if (!isProduction) {
    Log.addNewLineIfNone();
    Log.log('🚀 If you are ready to deploy to production, run this command with "--prod"');
    Log.log(chalk`  {dim $} eas deploy {bold --prod}`);
  }
}
