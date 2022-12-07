import { Job, Metadata } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import { ChildProcess } from 'child_process';
import semver from 'semver';

import { ora } from '../ora';

const PLUGIN_PACKAGE_NAME = 'eas-cli-local-build-plugin';
const PLUGIN_PACKAGE_VERSION = '0.0.120';

export enum LocalBuildMode {
  DISABLED,
  LOCAL_BUILD_PLUGIN,
  INTERNAL,
}

export interface LocalBuildOptions {
  localBuildMode: LocalBuildMode;
  skipCleanup?: boolean;
  skipNativeBuild?: boolean;
  artifactsDir?: string;
  artifactPath?: string;
  workingdir?: string;
  verbose?: boolean;
}

export async function runLocalBuildAsync(
  job: Job,
  metadata: Metadata,
  options: LocalBuildOptions
): Promise<void> {
  const { command, args } = await getCommandAndArgsAsync(job, metadata);
  let spinner;
  if (!options.verbose) {
    spinner = ora().start(options.skipNativeBuild ? 'Preparing project' : 'Building project');
  }
  let childProcess: ChildProcess | undefined;
  const interruptHandler = (): void => {
    if (childProcess) {
      childProcess.kill();
    }
  };
  process.on('SIGINT', interruptHandler);
  try {
    const spawnPromise = spawnAsync(command, args, {
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        EAS_LOCAL_BUILD_WORKINGDIR: options.workingdir ?? process.env.EAS_LOCAL_BUILD_WORKINGDIR,
        ...(options.skipCleanup || options.skipNativeBuild
          ? { EAS_LOCAL_BUILD_SKIP_CLEANUP: '1' }
          : {}),
        ...(options.skipNativeBuild ? { EAS_LOCAL_BUILD_SKIP_NATIVE_BUILD: '1' } : {}),
        ...(options.artifactsDir ? { EAS_LOCAL_BUILD_ARTIFACTS_DIR: options.artifactsDir } : {}),
        ...(options.artifactPath ? { EAS_LOCAL_BUILD_ARTIFACT_PATH: options.artifactPath } : {}),
      },
    });
    childProcess = spawnPromise.child;
    await spawnPromise;
  } finally {
    process.removeListener('SIGINT', interruptHandler);
    spinner?.stop();
  }
}

async function getCommandAndArgsAsync(
  job: Job,
  metadata: Metadata
): Promise<{ command: string; args: string[] }> {
  const jobAndMetadataBase64 = Buffer.from(JSON.stringify({ job, metadata })).toString('base64');
  if (process.env.EAS_LOCAL_BUILD_PLUGIN_PATH) {
    return {
      command: process.env.EAS_LOCAL_BUILD_PLUGIN_PATH,
      args: [jobAndMetadataBase64],
    };
  } else {
    const args = [`${PLUGIN_PACKAGE_NAME}@${PLUGIN_PACKAGE_VERSION}`, jobAndMetadataBase64];
    if (await isAtLeastNpm7Async()) {
      // npx shipped with npm >= 7.0.0 requires the "-y" flag to run commands without
      // prompting the user to install a package that is used for the first time
      args.unshift('-y');
    }
    return {
      command: 'npx',
      args,
    };
  }
}

async function isAtLeastNpm7Async(): Promise<boolean> {
  const version = (await spawnAsync('npm', ['--version'])).stdout.trim();
  return semver.gte(version, '7.0.0');
}
