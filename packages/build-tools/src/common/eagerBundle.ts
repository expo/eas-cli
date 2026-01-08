import { Metadata, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import semver from 'semver';

import { runExpoCliCommand } from '../utils/project';
import { PackageManager } from '../utils/packageManager';

export async function eagerBundleAsync({
  platform,
  workingDir,
  logger,
  env,
  packageManager,
}: {
  platform: Platform;
  workingDir: string;
  logger: bunyan;
  env: Record<string, string | undefined>;
  packageManager: PackageManager;
}): Promise<void> {
  await runExpoCliCommand({
    args: ['export:embed', '--eager', '--platform', platform, '--dev', 'false'],
    options: {
      cwd: workingDir,
      logger,
      env,
    },
    packageManager,
  });
}

export function shouldUseEagerBundle(metadata: Metadata | null | undefined): boolean {
  return Boolean(
    !metadata?.developmentClient &&
      metadata?.sdkVersion &&
      semver.satisfies(metadata?.sdkVersion, '>=52')
  );
}
