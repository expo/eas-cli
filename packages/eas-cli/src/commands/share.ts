import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import fg from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../commandUtils/flags';
import { UploadSessionType } from '../graphql/generated';
import { ShareBuildMutation } from '../graphql/mutations/ShareBuildMutation';
import Log from '../log';
import { promptAsync } from '../prompts';
import { uploadFileAtPathToGCSAsync } from '../uploads';
import { createProgressTracker } from '../utils/progress';

export default class BuildUpload extends EasCommand {
  static override description = 'upload a local build and generate a sharable link';

  static override flags = {
    platform: Flags.enum<Platform.IOS | Platform.ANDROID>({
      char: 'p',
      options: [Platform.IOS, Platform.ANDROID],
    }),
    'build-path': Flags.string({
      description: 'Path for the local build',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildUpload);
    const { 'build-path': buildPath } = flags;
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildUpload, {
      nonInteractive: false,
    });

    const platform = await this.selectPlatformAsync(flags.platform);
    const localBuildPath = await resolveLocalBuildPathAsync({
      platform,
      buildPath,
    });

    Log.log('Uploading your app archive to EAS Share');
    const bucketKey = await uploadAppArchiveAsync(graphqlClient, localBuildPath);

    // @TODO: use Share build mutation
    const { debugInfoUrl } = await ShareBuildMutation.uploadLocalBuildAsync(
      graphqlClient,
      projectId,
      { bucketKey },
      {
        // @TODO: read the fingerprint from the local build
        hash: '',
      }
    );

    Log.withTick(`Here is a sharable link of your build: ${debugInfoUrl}`);
  }

  private async selectPlatformAsync(platform?: Platform): Promise<Platform> {
    if (platform) {
      return platform;
    }
    const { resolvedPlatform } = await promptAsync({
      type: 'select',
      message: 'Select platform',
      name: 'resolvedPlatform',
      choices: [
        { title: 'Android', value: Platform.ANDROID },
        { title: 'iOS', value: Platform.IOS },
      ],
    });
    return resolvedPlatform;
  }
}

async function resolveLocalBuildPathAsync({
  platform,
  buildPath,
}: {
  platform: Platform;
  buildPath?: string;
}): Promise<string> {
  const applicationArchivePatternOrPath =
    buildPath ?? platform === Platform.ANDROID
      ? 'android/app/build/outputs/**/*.{apk,aab}'
      : 'ios/build/Build/Products/*simulator/*.app';

  const applicationArchives = await findArtifactsAsync({
    rootDir: process.cwd(),
    patternOrPath: applicationArchivePatternOrPath,
  });

  const count = applicationArchives.length;
  Log.log(
    `Found ${count} application archive${count > 1 ? 's' : ''}:\n- ${applicationArchives.join(
      '\n- '
    )}`
  );
  return applicationArchives[0];
}

async function findArtifactsAsync({
  rootDir,
  patternOrPath,
}: {
  rootDir: string;
  patternOrPath: string;
}): Promise<string[]> {
  const files: string[] = path.isAbsolute(patternOrPath)
    ? (await fs.pathExists(patternOrPath))
      ? [patternOrPath]
      : []
    : await fg(patternOrPath, { cwd: rootDir, onlyFiles: false });
  if (files.length === 0) {
    throw new Error(`Found no application archives for "${patternOrPath}".`);
  }

  return files.map(filePath => {
    // User may provide an absolute path as input in which case
    // fg will return an absolute path.
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // User may also provide a relative path in which case
    // fg will return a path relative to rootDir.
    return path.join(rootDir, filePath);
  });
}

async function uploadAppArchiveAsync(
  graphqlClient: ExpoGraphqlClient,
  path: string
): Promise<string> {
  const fileSize = (await fs.stat(path)).size;
  const bucketKey = await uploadFileAtPathToGCSAsync(
    graphqlClient,
    UploadSessionType.EasShareGcsAppArchive,
    path,
    createProgressTracker({
      total: fileSize,
      message: 'Uploading to EAS Share',
      completedMessage: 'Uploaded to EAS Share',
    })
  );
  return bucketKey;
}
