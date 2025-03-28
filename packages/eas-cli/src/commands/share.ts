import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import fg from 'fast-glob';
import fs from 'fs-extra';
import StreamZip from 'node-stream-zip';
import path from 'path';
import tar from 'tar';

import { getBuildLogsUrl } from '../build/utils/url';
import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../commandUtils/flags';
import {
  DistributionType,
  LocalBuildArchiveSourceType,
  UploadSessionType,
} from '../graphql/generated';
import { FingerprintMutation } from '../graphql/mutations/FingerprintMutation';
import { LocalBuildMutation } from '../graphql/mutations/LocalBuildMutation';
import { toAppPlatform } from '../graphql/types/AppPlatform';
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
    fingerprint: Flags.string({
      description: 'Fingerprint hash of the local build',
    }),
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildUpload);
    const { 'build-path': buildPath, fingerprint: manualFingerprintHash } = flags;
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildUpload, {
      nonInteractive: false,
    });

    const platform = await this.selectPlatformAsync(flags.platform);
    const localBuildPath = await resolveLocalBuildPathAsync(platform, buildPath);

    const {
      fingerprintHash: buildFingerprintHash,
      developmentClient,
      simulator,
    } = await extractAppMetadataAsync(localBuildPath, platform);

    let fingerprint = manualFingerprintHash ?? buildFingerprintHash;
    if (fingerprint) {
      if (
        manualFingerprintHash &&
        buildFingerprintHash &&
        manualFingerprintHash !== buildFingerprintHash
      ) {
        const selectedAnswer = await promptAsync({
          name: 'fingerprint',
          message: `The provided fingerprint hash ${manualFingerprintHash} does not match the fingerprint hash of the build ${buildFingerprintHash}. Which fingerprint do you want to use?`,
          type: 'select',
          choices: [{ title: manualFingerprintHash }, { title: buildFingerprintHash }],
        });
        fingerprint = String(selectedAnswer.fingerprint);
      }

      await FingerprintMutation.createFingerprintAsync(graphqlClient, projectId, {
        hash: fingerprint,
      });
    }

    Log.log('Uploading your app archive to EAS');
    const bucketKey = await uploadAppArchiveAsync(graphqlClient, localBuildPath);

    const build = await LocalBuildMutation.createLocalBuildAsync(
      graphqlClient,
      projectId,
      { platform: toAppPlatform(platform), simulator },
      { type: LocalBuildArchiveSourceType.Gcs, bucketKey },
      { distribution: DistributionType.Internal, fingerprintHash: fingerprint, developmentClient }
    );

    Log.withTick(`Here is a sharable link of your build: ${getBuildLogsUrl(build)}`);
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

async function resolveLocalBuildPathAsync(
  platform: Platform,
  inputBuildPath?: string
): Promise<string> {
  const applicationArchivePatternOrPath =
    inputBuildPath ??
    (platform === Platform.ANDROID
      ? 'android/app/build/outputs/**/*.{apk,aab}'
      : 'ios/build/Build/Products/*simulator/*.app');

  let applicationArchives = await findArtifactsAsync({
    rootDir: process.cwd(),
    patternOrPath: applicationArchivePatternOrPath,
  });

  if (applicationArchives.length === 0 && !inputBuildPath) {
    Log.warn(`No application archives found at ${applicationArchivePatternOrPath}.`);
    const { path } = await promptAsync({
      type: 'text',
      name: 'path',
      message: 'Provide a path to the application archive:',
      validate: value => (value ? true : 'Path may not be empty.'),
    });
    applicationArchives = await findArtifactsAsync({
      rootDir: process.cwd(),
      patternOrPath: path,
    });
  }

  if (applicationArchives.length === 1) {
    return applicationArchives[0];
  }

  if (applicationArchives.length > 1) {
    const { path } = await promptAsync({
      type: 'select',
      name: 'path',
      message: 'Found multiple application archives. Select one:',
      choices: applicationArchives.map(archivePath => {
        return {
          title: archivePath,
          value: archivePath,
        };
      }),
    });
    return path;
  }

  throw new Error(`Found no application archives at ${inputBuildPath}.`);
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

type AppMetadata = {
  fingerprintHash?: string;
  developmentClient: boolean;
  simulator: boolean;
};

async function extractAppMetadataAsync(
  buildPath: string,
  platform: Platform
): Promise<AppMetadata> {
  let developmentClient = false;
  let fingerprintHash: string | undefined;
  const simulator = platform === Platform.IOS;

  let basePath = platform === Platform.ANDROID ? 'assets/' : buildPath;
  const fingerprintFilePath =
    platform === Platform.ANDROID ? 'fingerprint' : 'EXUpdates.bundle/fingerprint';
  const devMenuBundlePath =
    platform === Platform.ANDROID ? 'EXDevMenuApp.android.js' : 'EXDevMenu.bundle/';

  const buildExtension = path.extname(buildPath);
  if (['.apk', '.ipa', '.aab'].includes(buildExtension)) {
    const zip = new StreamZip.async({ file: buildPath });
    try {
      if (buildExtension === '.ipa') {
        const entries = await zip.entries();
        basePath =
          Object.keys(entries).find(
            entry => entry.startsWith('Payload/') && entry.endsWith('.app/')
          ) ?? basePath;
      }

      developmentClient = Boolean(await zip.entry(path.join(basePath, devMenuBundlePath)));
      if (await zip.entry(path.join(basePath, fingerprintFilePath))) {
        fingerprintHash = (await zip.entryData(path.join(basePath, fingerprintFilePath))).toString(
          'utf-8'
        );
      }
    } catch (err) {
      Log.error(`Error reading ${buildExtension}: ${err}`);
    } finally {
      await zip.close();
    }
  } else if (buildExtension === '.app') {
    developmentClient = await fs.exists(path.join(basePath, devMenuBundlePath));

    if (await fs.exists(path.join(basePath, fingerprintFilePath))) {
      fingerprintHash = await fs.readFile(path.join(basePath, fingerprintFilePath), 'utf8');
    }
  } else {
    // Use tar to list files in the archive
    try {
      let fingerprintHashPromise: Promise<string> | undefined;
      await tar.list({
        file: buildPath,
        // eslint-disable-next-line async-protect/async-suffix
        onentry: entry => {
          if (entry.path.endsWith(devMenuBundlePath)) {
            developmentClient = true;
          }
          if (entry.path.endsWith(fingerprintFilePath)) {
            fingerprintHashPromise = new Promise<string>(async (resolve, reject) => {
              try {
                let content = '';
                for await (const chunk of entry) {
                  content += chunk.toString('utf8');
                }
                resolve(content);
              } catch (error) {
                reject(error);
              }
            });
          }
        },
      });
      if (fingerprintHashPromise !== undefined) {
        fingerprintHash = await fingerprintHashPromise;
      }
    } catch (err) {
      Log.error(`Error reading ${buildExtension}: ${err}`);
    }
  }

  return {
    developmentClient,
    fingerprintHash,
    simulator,
  };
}
