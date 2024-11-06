import { Env, Workflow } from '@expo/eas-build-job';
import { silent as silentResolveFrom } from 'resolve-from';

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
  // eslint-disable-next-line @typescript-eslint/return-await
  return await Fingerprint.createFingerprintAsync(projectDir, fingerprintOptions);
}
