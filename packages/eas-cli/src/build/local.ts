import { Job } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import semver from 'semver';

const PLUGIN_PACKAGE_NAME = 'eas-cli-local-build-plugin';
const PLUGIN_PACKAGE_VERSION = '0.0.50';

export async function runLocalBuildAsync(job: Job): Promise<void> {
  const { command, args } = await getCommandAndArgsAsync(job);
  await spawnAsync(command, args, {
    stdio: 'inherit',
  });
}

async function getCommandAndArgsAsync(job: Job): Promise<{ command: string; args: string[] }> {
  const jobBase64 = Buffer.from(JSON.stringify({ job })).toString('base64');
  if (process.env.EAS_LOCAL_BUILD_PLUGIN_PATH) {
    return {
      command: process.env.EAS_LOCAL_BUILD_PLUGIN_PATH,
      args: [jobBase64],
    };
  } else {
    const args = [`${PLUGIN_PACKAGE_NAME}@${PLUGIN_PACKAGE_VERSION}`, jobBase64];
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
