import { UserError } from '@expo/eas-build-job';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';

export async function readIosApplicationIdentifierAsync({
  artifactPath,
  env,
}: {
  artifactPath: string;
  env: BuildStepEnv;
}): Promise<string> {
  const artifactStat = await fs.promises.stat(artifactPath).catch(err => {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      `Build artifact does not exist at ${artifactPath}.`,
      { cause: err }
    );
  });
  if (path.extname(artifactPath) !== '.app' || !artifactStat.isDirectory()) {
    throw new UserError(
      'EAS_INSTALL_BUILD_INVALID_ARTIFACT',
      'iOS Simulator sessions require a .app build artifact.'
    );
  }
  const infoPlistPath = path.join(artifactPath, 'Info.plist');
  const { stdout } = await spawn(
    'plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlistPath],
    { stdio: 'pipe', env }
  );
  const applicationIdentifier = stdout.trim();
  if (!applicationIdentifier) {
    throw new UserError(
      'EAS_INSTALL_BUILD_MISSING_IDENTIFIER',
      `Could not read CFBundleIdentifier from ${infoPlistPath}.`
    );
  }
  return applicationIdentifier;
}
