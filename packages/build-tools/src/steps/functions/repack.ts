import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import resolveFrom from 'resolve-from';
import { Platform, type Android, type Ios, type Job } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
  spawnAsync,
} from '@expo/steps';
import {
  type AndroidSigningOptions,
  type IosSigningOptions,
  type SpawnProcessAsync,
  type SpawnProcessOptions,
  type SpawnProcessPromise,
  type SpawnProcessResult,
} from '@expo/repack-app';

import { COMMON_FASTLANE_ENV } from '../../common/fastlane';
import IosCredentialsManager from '../utils/ios/credentials/manager';

export function createRepackBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'repack',
    name: 'Repack app',
    __metricsId: 'eas/repack',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'source_app_path',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'platform',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'output_path',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'embed_bundle_assets',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'repack_version',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
        defaultValue: 'latest',
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'output_path',
        required: true,
      }),
    ],
    fn: async (stepsCtx, { inputs, outputs, env }) => {
      const projectRoot = stepsCtx.workingDirectory;
      const verbose = stepsCtx.global.env['EAS_VERBOSE'] === '1';

      const platform =
        (inputs.platform.value as Platform) ?? stepsCtx.global.staticContext.job.platform;
      if (![Platform.ANDROID, Platform.IOS].includes(platform)) {
        throw new Error(
          `Unsupported platform: ${platform}. Platform must be "${Platform.ANDROID}" or "${Platform.IOS}"`
        );
      }

      const repackSpawnAsync = createSpawnAsyncStepAdapter({ verbose, logger: stepsCtx.logger });

      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `repack-`));
      const workingDirectory = path.join(tmpDir, 'working-directory');
      await fs.promises.mkdir(workingDirectory);
      stepsCtx.logger.info(`Created temporary working directory: ${workingDirectory}`);

      const sourceAppPath = inputs.source_app_path.value as string;
      const outputPath =
        (inputs.output_path.value as string) ??
        path.join(tmpDir, `repacked-${randomUUID()}${path.extname(sourceAppPath)}`);
      const exportEmbedOptions = inputs.embed_bundle_assets.value
        ? {
            sourcemapOutput: undefined,
          }
        : undefined;

      stepsCtx.logger.info(`Using repack tool version: ${inputs.repack_version.value}`);
      const repackApp = await installAndImportRepackAsync(inputs.repack_version.value as string);
      const { repackAppIosAsync, repackAppAndroidAsync } = repackApp;

      stepsCtx.logger.info('Repacking the app...');
      switch (platform) {
        case Platform.IOS:
          await repackAppIosAsync({
            platform: 'ios',
            projectRoot,
            sourceAppPath,
            outputPath,
            workingDirectory,
            exportEmbedOptions,
            iosSigningOptions: await resolveIosSigningOptionsAsync({
              job: stepsCtx.global.staticContext.job,
              logger: stepsCtx.logger,
            }),
            logger: stepsCtx.logger,
            spawnAsync: repackSpawnAsync,
            verbose,
            env: {
              ...COMMON_FASTLANE_ENV,
              ...env,
            },
          });
          break;
        case Platform.ANDROID:
          {
            const androidSigningOptions = await resolveAndroidSigningOptionsAsync({
              job: stepsCtx.global.staticContext.job,
              tmpDir,
            });

            try {
              await repackAppAndroidAsync({
                platform: 'android',
                projectRoot,
                sourceAppPath,
                outputPath,
                workingDirectory,
                exportEmbedOptions,
                androidSigningOptions,
                logger: stepsCtx.logger,
                spawnAsync: repackSpawnAsync,
                verbose,
                env,
              });
            } finally {
              const keyStorePath = androidSigningOptions?.keyStorePath;
              if (keyStorePath) {
                await fs.promises.rm(keyStorePath, { force: true });
              }
            }
          }
          break;
      }

      stepsCtx.logger.info(`Repacked the app to ${outputPath}`);
      outputs.output_path.set(outputPath);
    },
  });
}

/**
 * Install `@expo/repack-app` in a sandbox directory and import it.
 */
async function installAndImportRepackAsync(
  version: string = 'latest'
): Promise<typeof import('@expo/repack-app')> {
  const sandbox = await fs.promises.mkdtemp(path.join(os.tmpdir(), `repack-package-root-`));
  await spawnAsync('yarn', ['add', `@expo/repack-app@${version}`], {
    stdio: 'inherit',
    cwd: sandbox,
  });
  return require(resolveFrom(sandbox, '@expo/repack-app'));
}

/**
 * Creates `@expo/steps` based spawnAsync for repack.
 */
function createSpawnAsyncStepAdapter({
  verbose,
  logger,
}: {
  verbose: boolean;
  logger: bunyan;
}): SpawnProcessAsync {
  return function repackSpawnAsync(
    command: string,
    args: string[],
    options?: SpawnProcessOptions
  ): SpawnProcessPromise<SpawnProcessResult> {
    const promise = spawnAsync(command, args, {
      ...options,
      ...(verbose ? { logger, stdio: 'pipe' } : { logger: undefined }),
    });
    const child = promise.child;
    const wrappedPromise = promise.catch((error) => {
      logger.error(`Error while running command: ${command} ${args.join(' ')}`);
      logger.error(`stdout: ${error.stdout}`);
      logger.error(`stderr: ${error.stderr}`);
      throw error;
    }) as SpawnProcessPromise<SpawnProcessResult>;
    wrappedPromise.child = child;
    return wrappedPromise;
  };
}

/**
 * Resolves Android signing options from the job secrets.
 */
export async function resolveAndroidSigningOptionsAsync({
  job,
  tmpDir,
}: {
  job: Job;
  tmpDir: string;
}): Promise<AndroidSigningOptions | undefined> {
  const androidJob = job as Android.Job;
  const buildCredentials = androidJob.secrets?.buildCredentials;
  if (buildCredentials?.keystore.dataBase64 == null) {
    return undefined;
  }
  const keyStorePath = path.join(tmpDir, `keystore-${randomUUID()}`);
  await fs.promises.writeFile(
    keyStorePath,
    Buffer.from(buildCredentials.keystore.dataBase64, 'base64')
  );

  const keyStorePassword = `pass:${buildCredentials.keystore.keystorePassword}`;
  const keyAlias = buildCredentials.keystore.keyAlias;
  const keyPassword = buildCredentials.keystore.keyPassword
    ? `pass:${buildCredentials.keystore.keyPassword}`
    : undefined;
  return {
    keyStorePath,
    keyStorePassword,
    keyAlias,
    keyPassword,
  };
}

/**
 * Resolves iOS signing options from the job secrets.
 */
export async function resolveIosSigningOptionsAsync({
  job,
  logger,
}: {
  job: Job;
  logger: bunyan;
}): Promise<IosSigningOptions | undefined> {
  const iosJob = job as Ios.Job;
  const buildCredentials = iosJob.secrets?.buildCredentials;
  if (iosJob.simulator || buildCredentials == null) {
    return undefined;
  }
  const credentialsManager = new IosCredentialsManager(buildCredentials);
  const credentials = await credentialsManager.prepare(logger);

  const provisioningProfile: Record<string, string> = {};
  for (const profile of Object.values(credentials.targetProvisioningProfiles)) {
    provisioningProfile[profile.bundleIdentifier] = profile.path;
  }
  return {
    provisioningProfile,
    keychainPath: credentials.keychainPath,
    signingIdentity: credentials.applicationTargetProvisioningProfile.data.certificateCommonName,
  };
}
