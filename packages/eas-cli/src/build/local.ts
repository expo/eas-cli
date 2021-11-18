import { Job } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';

const PLUGIN_PACKAGE_NAME = 'eas-cli-local-build-plugin';
const PLUGIN_PACKAGE_VERSION = '0.0.50';

export async function runLocalBuildAsync(job: Job): Promise<void> {
  const { command, args } = getCommandAndArgs(job);
  await spawnAsync(command, args, {
    stdio: 'inherit',
  });
}

function getCommandAndArgs(job: Job): { command: string; args: string[] } {
  const jobBase64 = Buffer.from(JSON.stringify({ job })).toString('base64');
  if (process.env.EAS_LOCAL_BUILD_PLUGIN_PATH) {
    return {
      command: process.env.EAS_LOCAL_BUILD_PLUGIN_PATH,
      args: [jobBase64],
    };
  } else {
    return {
      command: 'npx',
      args: ['-y', `${PLUGIN_PACKAGE_NAME}@${PLUGIN_PACKAGE_VERSION}`, jobBase64],
    };
  }
}
