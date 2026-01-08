import { Job, Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import spawnAsync from '@expo/spawn-async';
import fs from 'fs-extra';

interface Validator {
  platform?: Platform;
  checkAsync: (job: Job) => Promise<void>;
}

function warn(msg: string): void {
  console.log(chalk.yellow(msg));
}

function error(msg: string): void {
  console.error(chalk.red(msg));
}

const validators: Validator[] = [
  {
    async checkAsync(job: Job) {
      if (job.platform === Platform.IOS && process.platform !== 'darwin') {
        throw new Error('iOS builds can only be run on macOS.');
      } else if (
        job.platform === Platform.ANDROID &&
        !['linux', 'darwin'].includes(process.platform)
      ) {
        throw new Error('Android builds are supported only on Linux and macOS');
      }
    },
  },
  {
    async checkAsync(job: Job) {
      try {
        const version = (await spawnAsync('node', ['--version'], { stdio: 'pipe' })).stdout.trim();
        const sanitizedVersion = version.startsWith('v') ? version.slice(1) : version;
        const versionFromJob = job.builderEnvironment?.node;
        if (versionFromJob) {
          const sanitizedVersionFromJob = versionFromJob.startsWith('v')
            ? versionFromJob.slice(1)
            : versionFromJob;
          if (sanitizedVersion !== sanitizedVersionFromJob) {
            warn(
              'Node.js version in your eas.json does not match the Node.js currently installed in your system'
            );
          }
        }
      } catch (err) {
        error("Node.js is not available, make sure it's installed and in your PATH");
        throw err;
      }
    },
  },
  {
    async checkAsync(job: Job) {
      const versionFromJob = job.builderEnvironment?.yarn;
      if (!versionFromJob) {
        return;
      }
      try {
        const version = (await spawnAsync('yarn', ['--version'], { stdio: 'pipe' })).stdout.trim();
        if (versionFromJob !== version) {
          warn(
            'Yarn version in your eas.json does not match the yarn currently installed in your system'
          );
        }
      } catch {
        warn("Yarn is not available, make sure it's installed and in your PATH");
      }
    },
  },
  {
    platform: Platform.ANDROID,
    async checkAsync(_) {
      if (!process.env.ANDROID_NDK_HOME) {
        warn(
          'ANDROID_NDK_HOME environment variable was not specified, continuing build without NDK'
        );
        return;
      }
      if (!(await fs.pathExists(process.env.ANDROID_NDK_HOME))) {
        throw new Error(`NDK was not found under ${process.env.ANDROID_NDK_HOME}`);
      }
    },
  },
  {
    platform: Platform.IOS,
    async checkAsync() {
      try {
        await spawnAsync('fastlane', ['--version'], {
          stdio: 'pipe',
          env: {
            ...process.env,
            FASTLANE_DISABLE_COLORS: '1',
            FASTLANE_SKIP_UPDATE_CHECK: '1',
            SKIP_SLOW_FASTLANE_WARNING: 'true',
            FASTLANE_HIDE_TIMESTAMP: 'true',
          },
        });
      } catch (err) {
        error("Fastlane is not available, make sure it's installed and in your PATH");
        throw err;
      }
    },
  },
  {
    platform: Platform.IOS,
    async checkAsync(job: Job) {
      try {
        const version = (await spawnAsync('pod', ['--version'], { stdio: 'pipe' })).stdout.trim();
        const versionFromJob = job.platform === Platform.IOS && job.builderEnvironment?.cocoapods;
        if (versionFromJob && versionFromJob !== version) {
          warn(
            'Cocoapods version in your eas.json does not match the version currently installed in your system'
          );
        }
      } catch (err) {
        error("Cocoapods is not available, make sure it's installed and in your PATH");
        throw err;
      }
    },
  },
];

export async function checkRuntimeAsync(job: Job): Promise<void> {
  for (const validator of validators) {
    if (validator.platform === job.platform || !validator.platform) {
      await validator.checkAsync(job);
    }
  }
}
