import chalk from 'chalk';
import fs from 'node:fs/promises';
import * as path from 'node:path';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { ora } from '../../ora';
import { createProgressTracker } from '../../utils/progress';
import * as WorkerAssets from '../../worker/assets';
import { getSignedDeploymentUrlAsync } from '../../worker/deployment';
import { UploadParams, batchUploadAsync, uploadAsync } from '../../worker/upload';

const isDirectory = (directoryPath: string): Promise<boolean> =>
  fs
    .stat(directoryPath)
    .then(stat => stat.isDirectory())
    .catch(() => false);

export default class WorkerDeploy extends EasCommand {
  static override description = 'deploy an Expo web build';
  static override aliases = ['deploy'];

  static override flags = {
    // TODO: Allow deployment identifier to be specified
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    Log.warn('EAS Worker Deployments are in beta and subject to breaking changes.');

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(WorkerDeploy, {
      nonInteractive: true,
    });

    const distPath = path.resolve(projectDir, 'dist');
    const distClientPath = path.resolve(distPath, 'client');
    const distServerPath = path.resolve(distPath, 'server');
    if (!(await isDirectory(distPath))) {
      throw new Error(
        `No "dist/" folder found at ${distPath}. Prepare your project for deployment with "npx expo export"`
      );
    } else if (!(await isDirectory(distClientPath))) {
      throw new Error(
        `No "dist/client/" folder found at ${distClientPath}. Ensure the app.json key "expo.web.output" is set to "server"`
      );
    } else if (!(await isDirectory(distServerPath))) {
      throw new Error(
        `No "dist/server/" folder found in ${distServerPath}. Ensure the app.json key "expo.web.output" is set to "server"`
      );
    }

    async function* emitWorkerTarballAsync(
      assetMap: WorkerAssets.AssetMap
    ): AsyncGenerator<WorkerAssets.FileEntry> {
      yield ['assets.json', JSON.stringify(assetMap)];

      // TODO: Create manifest from user configuration
      const manifest = { env: {} };
      yield ['manifest.json', JSON.stringify(manifest)];

      const workerFiles = WorkerAssets.listWorkerFiles(distServerPath);
      for await (const workerFile of workerFiles) {
        yield [`server/${workerFile.normalizedPath}`, workerFile.data];
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
            `The gzipped files in "dist/server/" (at: ${distServerPath}) exceed the maximum file size.`
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
      for await (const asset of WorkerAssets.listAssetMapFiles(distClientPath, assetMap)) {
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
        completedMessage: 'Uploaded client assets for worker deployment',
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
      } finally {
        updateProgress({ isComplete: true });
      }
    }

    let progress = ora('Preparing worker upload');
    let assetMap: WorkerAssets.AssetMap;
    let tarPath: string;
    try {
      assetMap = await WorkerAssets.createAssetMap(distClientPath);
      tarPath = await WorkerAssets.packFilesIterable(emitWorkerTarballAsync(assetMap));
    } catch (error: any) {
      progress.fail(error);
      return;
    } finally {
      progress.succeed('Prepared worker upload');
    }

    progress = ora('Creating worker deployment');
    let deployResult: any;
    try {
      deployResult = await uploadTarballAsync(tarPath);
    } catch (error: any) {
      progress.fail(error);
      return;
    } finally {
      progress.succeed('Created worker deploymnt');
    }

    await uploadAssetsAsync(assetMap, deployResult.uploads);

    const baseDomain = process.env.EXPO_STAGING ? 'staging.expo.app' : 'expo.app';
    const deploymentURL = `https://${deployResult.fullName}.${baseDomain}`;

    Log.addNewLineIfNone();
    Log.log(`🎉 Your worker deployment is ready: ${deploymentURL}`);
  }
}
