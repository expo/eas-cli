import { IOSConfig } from '@expo/config-plugins';
import { Platform } from '@expo/eas-build-job';
import { Flags } from '@oclif/core';
import fg from 'fast-glob';
import fs from 'fs-extra';
import StreamZip from 'node-stream-zip';
import path from 'path';
import * as tar from 'tar';
import { v4 as uuidv4 } from 'uuid';

import { getBuildLogsUrl } from '../build/utils/url';
import EasCommand from '../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../commandUtils/flags';
import {
  BuildMetadataInput,
  DistributionType,
  LocalBuildArchiveSourceType,
  UploadSessionType,
} from '../graphql/generated';
import { FingerprintMutation } from '../graphql/mutations/FingerprintMutation';
import { LocalBuildMutation } from '../graphql/mutations/LocalBuildMutation';
import { toAppPlatform } from '../graphql/types/AppPlatform';
import Log from '../log';
import { promptAsync } from '../prompts';
import * as xcode from '../run/ios/xcode';
import { uploadFileAtPathToGCSAsync } from '../uploads';
import { fromNow } from '../utils/date';
import { enableJsonOutput, printJsonOnlyOutput } from '../utils/json';
import { getTmpDirectory } from '../utils/paths';
import { parseBinaryPlistBuffer } from '../utils/plist';
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
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildUpload);
    const {
      'build-path': buildPath,
      fingerprint: manualFingerprintHash,
      json: jsonFlag,
      'non-interactive': nonInteractive,
    } = flags;
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildUpload, {
      nonInteractive,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const platform = await this.selectPlatformAsync({ platform: flags.platform, nonInteractive });
    const localBuildPath = await resolveLocalBuildPathAsync({
      platform,
      inputBuildPath: buildPath,
      nonInteractive,
    });

    const {
      fingerprintHash: buildFingerprintHash,
      developmentClient,
      simulator,
      ...otherMetadata
    } = await extractAppMetadataAsync(localBuildPath, platform);

    let fingerprint = manualFingerprintHash ?? buildFingerprintHash;
    if (fingerprint) {
      if (
        manualFingerprintHash &&
        buildFingerprintHash &&
        manualFingerprintHash !== buildFingerprintHash &&
        !nonInteractive
      ) {
        const selectedAnswer = await promptAsync({
          name: 'fingerprint',
          message: `The provided fingerprint hash ${manualFingerprintHash} does not match the fingerprint hash of the build ${buildFingerprintHash}. Which fingerprint do you want to use?`,
          type: 'select',
          choices: [
            { title: manualFingerprintHash, value: manualFingerprintHash },
            { title: buildFingerprintHash, value: buildFingerprintHash },
          ],
        });
        fingerprint = String(selectedAnswer.fingerprint);
      }

      await FingerprintMutation.createFingerprintAsync(graphqlClient, projectId, {
        hash: fingerprint,
      });
    }

    Log.log(`Using build ${localBuildPath}`);
    Log.log(`Fingerprint hash: ${fingerprint ?? 'Unknown'}`);

    Log.log('Uploading your app archive to EAS');
    const bucketKey = await uploadAppArchiveAsync(graphqlClient, localBuildPath);

    const build = await LocalBuildMutation.createLocalBuildAsync(
      graphqlClient,
      projectId,
      { platform: toAppPlatform(platform), simulator },
      { type: LocalBuildArchiveSourceType.Gcs, bucketKey },
      {
        distribution: DistributionType.Internal,
        fingerprintHash: fingerprint,
        developmentClient,
        ...otherMetadata,
      }
    );

    if (jsonFlag) {
      printJsonOnlyOutput({ url: getBuildLogsUrl(build) });
      return;
    }

    Log.withTick(`Shareable link to the build: ${getBuildLogsUrl(build)}`);
  }

  private async selectPlatformAsync({
    nonInteractive,
    platform,
  }: {
    nonInteractive: boolean;
    platform?: Platform;
  }): Promise<Platform> {
    if (nonInteractive && !platform) {
      throw new Error('Platform must be provided in non-interactive mode');
    }

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
  inputBuildPath,
  nonInteractive,
}: {
  platform: Platform;
  inputBuildPath?: string;
  nonInteractive: boolean;
}): Promise<string> {
  const rootDir = process.cwd();
  let applicationArchivePatternOrPath: string[] = [];

  if (inputBuildPath) {
    applicationArchivePatternOrPath.push(inputBuildPath);
  } else if (platform === Platform.ANDROID) {
    applicationArchivePatternOrPath.push('android/app/build/outputs/**/*.{apk,aab}');
  } else {
    const xcworkspacePath = await xcode.resolveXcodeProjectAsync(rootDir);
    const schemes = IOSConfig.BuildScheme.getRunnableSchemesFromXcodeproj(rootDir);
    if (xcworkspacePath && schemes.length > 0) {
      for (const scheme of schemes) {
        const buildSettings = await xcode.getXcodeBuildSettingsAsync(xcworkspacePath, scheme.name);
        applicationArchivePatternOrPath = applicationArchivePatternOrPath.concat(
          buildSettings.map(({ buildSettings }) => `${buildSettings.BUILD_DIR}/**/*.app`)
        );
      }
    }
  }

  let applicationArchives = await findArtifactsAsync({
    rootDir,
    patternOrPathArray: applicationArchivePatternOrPath,
  });

  if (applicationArchives.length === 0 && !nonInteractive && !inputBuildPath) {
    Log.warn(`No application archives found at ${applicationArchivePatternOrPath}.`);
    const { path } = await promptAsync({
      type: 'text',
      name: 'path',
      message: 'Provide a path to the application archive:',
      validate: value => (value ? true : 'Path may not be empty.'),
    });
    applicationArchives = await findArtifactsAsync({
      rootDir,
      patternOrPathArray: [path],
    });
  }

  if (applicationArchives.length === 1) {
    return applicationArchives[0];
  }

  if (applicationArchives.length > 1) {
    // sort by modification time
    const applicationArchivesInfo = await Promise.all(
      applicationArchives.map(async archivePath => ({
        path: archivePath,
        stat: await fs.stat(archivePath),
      }))
    );
    applicationArchivesInfo.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    if (nonInteractive) {
      return applicationArchivesInfo[0].path;
    }

    const { selectedPath } = await promptAsync({
      type: 'select',
      name: 'selectedPath',
      message: 'Found multiple application archives. Select one:',
      choices: applicationArchivesInfo.map(archive => {
        return {
          title: `${
            archive.path.startsWith(rootDir) ? path.relative(rootDir, archive.path) : archive.path
          } (${fromNow(archive.stat.mtime)} ago)`,
          value: archive.path,
        };
      }),
    });
    return selectedPath;
  }

  throw new Error(`Found no application archives at ${inputBuildPath}.`);
}

async function findArtifactsAsync({
  rootDir,
  patternOrPathArray,
}: {
  rootDir: string;
  patternOrPathArray: string[];
}): Promise<string[]> {
  const files = new Set<string>();
  for (const patternOrPath of patternOrPathArray) {
    if (path.isAbsolute(patternOrPath) && (await fs.pathExists(patternOrPath))) {
      files.add(patternOrPath);
    } else {
      const filesFound = await fg(patternOrPath, {
        cwd: rootDir,
        onlyFiles: false,
      });
      filesFound.forEach(file => files.add(file));
    }
  }

  return [...files].map(filePath => {
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
  originalPath: string
): Promise<string> {
  let filePath = originalPath;
  if ((await fs.stat(filePath)).isDirectory()) {
    await fs.mkdirp(getTmpDirectory());
    const tarPath = path.join(getTmpDirectory(), `${uuidv4()}.tar.gz`);
    const parentPath = path.dirname(originalPath);
    const folderName = path.basename(originalPath);
    await tar.create({ cwd: parentPath, file: tarPath, gzip: true }, [folderName]);
    filePath = tarPath;
  }
  const fileSize = (await fs.stat(filePath)).size;
  const bucketKey = await uploadFileAtPathToGCSAsync(
    graphqlClient,
    UploadSessionType.EasShareGcsAppArchive,
    filePath,
    createProgressTracker({
      total: fileSize,
      message: 'Uploading to EAS',
      completedMessage: 'Uploaded to EAS',
    })
  );
  return bucketKey;
}

function getInfoPlistMetadata(infoPlist: any): {
  appName?: string;
  appIdentifier?: string;
  simulator: boolean;
} {
  const appName = infoPlist?.CFBundleDisplayName ?? infoPlist?.CFBundleName;
  const appIdentifier = infoPlist?.CFBundleIdentifier;
  const simulator = infoPlist?.DTPlatformName?.includes('simulator');

  return {
    appName,
    appIdentifier,
    simulator,
  };
}

async function extractAppMetadataAsync(
  buildPath: string,
  platform: Platform
): Promise<{ developmentClient: boolean; simulator: boolean } & BuildMetadataInput> {
  let developmentClient = false;
  let fingerprintHash: string | undefined;

  // By default, we assume the iOS apps are for simulators
  let simulator = platform === Platform.IOS;
  let appName: string | undefined;
  let appIdentifier: string | undefined;

  const basePath = platform === Platform.ANDROID ? 'assets/' : buildPath;
  const fingerprintFilePath =
    platform === Platform.ANDROID ? 'fingerprint' : 'EXUpdates.bundle/fingerprint';
  const devMenuBundlePath =
    platform === Platform.ANDROID ? 'EXDevMenuApp.android.js' : 'EXDevMenu.bundle/';

  const buildExtension = path.extname(buildPath);
  if (['.apk', '.aab'].includes(buildExtension)) {
    const zip = new StreamZip.async({ file: buildPath });
    try {
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
    if (await fs.exists(path.join(basePath, 'Info.plist'))) {
      const infoPlistBuffer = await fs.readFile(path.join(basePath, 'Info.plist'));
      const infoPlist = parseBinaryPlistBuffer(infoPlistBuffer);
      ({ simulator, appIdentifier, appName } = getInfoPlistMetadata(infoPlist));
    }

    if (await fs.exists(path.join(basePath, fingerprintFilePath))) {
      fingerprintHash = await fs.readFile(path.join(basePath, fingerprintFilePath), 'utf8');
    }
  } else if (buildExtension === '.ipa') {
    const zip = new StreamZip.async({ file: buildPath });
    try {
      const entries = await zip.entries();
      const entriesKeys = Object.keys(entries);

      await Promise.all(
        entriesKeys.map(async path => {
          const infoPlistRegex = /^Payload\/[^/]+\.app\/Info\.plist$/;
          if (infoPlistRegex.test(path)) {
            const infoPlistBuffer = await zip.entryData(entries[path]);
            const infoPlist = parseBinaryPlistBuffer(infoPlistBuffer);
            ({ simulator, appIdentifier, appName } = getInfoPlistMetadata(infoPlist));
            return;
          }

          if (path.includes('/EXDevMenu.bundle')) {
            developmentClient = true;
            return;
          }

          if (path.includes('EXUpdates.bundle/fingerprint')) {
            fingerprintHash = (await zip.entryData(entries[path])).toString('utf-8');
          }
        })
      );
    } catch (err) {
      Log.error(`Error reading ${buildExtension}: ${err}`);
    } finally {
      await zip.close();
    }
  } else {
    // Use tar to list files in the archive
    try {
      let fingerprintHashPromise: Promise<string> | undefined;
      let infoPlistPromise: Promise<Buffer> | undefined;
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
          if (entry.path.endsWith('Info.plist')) {
            infoPlistPromise = new Promise<Buffer>(async (resolve, reject) => {
              try {
                const chunks: Buffer[] = [];
                for await (const chunk of entry) {
                  chunks.push(chunk);
                }
                const content = Buffer.concat(chunks);
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
      if (infoPlistPromise !== undefined) {
        const infoPlist = parseBinaryPlistBuffer(await infoPlistPromise);
        ({ simulator, appIdentifier, appName } = getInfoPlistMetadata(infoPlist));
      }
    } catch (err) {
      Log.error(`Error reading ${buildExtension}: ${err}`);
    }
  }

  return {
    developmentClient,
    fingerprintHash,
    simulator,
    appName,
    appIdentifier,
  };
}
