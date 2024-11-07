import { Env, Workflow } from '@expo/eas-build-job';
import { silent as silentResolveFrom } from 'resolve-from';

import Log from '../log';
import { ora } from '../ora';

export async function createFingerprintAsync(
  projectDir: string,
  options: {
    workflow: Workflow;
    platform: string;
    debug?: boolean;
    env: Env | undefined;
    cwd?: string;
  }
): Promise<{
  hash: string;
  sources: object[];
  isDebugSource: boolean;
} | null> {
  // @expo/fingerprint is exported in the expo package for SDK 52+
  const fingerprintPath = silentResolveFrom(projectDir, 'expo/fingerprint');
  if (!fingerprintPath) {
    return null;
  }

  if (process.env.EAS_SKIP_AUTO_FINGERPRINT) {
    Log.log('Skipping project fingerprint');
    return null;
  }

  const timeoutId = setTimeout(() => {
    Log.log('⌛️ Computing project fingerprint taking longer than expected...');
    Log.log('⏩ To skip this step, set the environment variable: EAS_SKIP_AUTO_FINGERPRINT=1');
  }, 5000);

  const spinner = ora(`Computing project fingerprint`).start();
  try {
    const Fingerprint = require(fingerprintPath);
    const fingerprintOptions: Record<string, any> = {};
    if (options.platform) {
      fingerprintOptions.platforms = [options.platform];
    }
    if (options.workflow === Workflow.MANAGED) {
      fingerprintOptions.ignorePaths = ['android/**/*', 'ios/**/*'];
    }
    if (options.debug) {
      fingerprintOptions.debug = true;
    }
    const fingerprint = await Fingerprint.createFingerprintAsync(projectDir, fingerprintOptions);
    spinner.succeed(`Computed project fingerprint`);
    return fingerprint;
  } catch (e) {
    spinner.fail(`Failed to compute project fingerprint`);
    Log.log('⏩ To skip this step, set the environment variable: EAS_SKIP_AUTO_FINGERPRINT=1');
    throw e;
  } finally {
    // Clear the timeout if the operation finishes before the time limit
    clearTimeout(timeoutId);
    spinner.stop();
  }
}
