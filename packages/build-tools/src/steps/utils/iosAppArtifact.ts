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

const EXPO_GO_BUNDLE_IDENTIFIER = 'host.exp.Exponent';

/**
 * Expo Go releases are identified by their version, so an installed copy with the same version is
 * the same app. Custom builds can reuse a version, so they are always installed.
 */
export async function isExpoGoVersionInstalledAsync({
  udid,
  appPath,
  env,
}: {
  udid: string;
  appPath: string;
  env: BuildStepEnv;
}): Promise<boolean> {
  try {
    const requested = await readBundleVersionsAsync(appPath, env);
    if (requested.identifier !== EXPO_GO_BUNDLE_IDENTIFIER) {
      return false;
    }
    const { stdout } = await spawn(
      'xcrun',
      ['simctl', 'get_app_container', udid, EXPO_GO_BUNDLE_IDENTIFIER, 'app'],
      { stdio: 'pipe', env }
    );
    const installed = await readBundleVersionsAsync(stdout.trim(), env);
    return (
      installed.identifier === requested.identifier &&
      installed.shortVersion === requested.shortVersion &&
      installed.version === requested.version
    );
  } catch {
    // An app that is not installed, or that cannot be read, is installed as usual.
    return false;
  }
}

async function readBundleVersionsAsync(
  appPath: string,
  env: BuildStepEnv
): Promise<{ identifier: string; shortVersion: string; version: string }> {
  const infoPlistPath = path.join(appPath, 'Info.plist');
  const [identifier, shortVersion, version] = await Promise.all(
    ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(async key =>
      (
        await spawn('plutil', ['-extract', key, 'raw', '-o', '-', infoPlistPath], {
          stdio: 'pipe',
          env,
        })
      ).stdout.trim()
    )
  );
  return { identifier, shortVersion, version };
}
