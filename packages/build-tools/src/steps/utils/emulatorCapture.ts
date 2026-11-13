import { UserError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installIsolatedNpmPackageAsync } from '../../utils/installIsolatedNpmPackageAsync';

// Experimental emulator capture. The Android Emulator preloads the expo-emulator-capture agent,
// which serves the emulator screen as H.264 on a Unix socket, and expo-device-hub streams the
// screen from that socket. The step input names the agent version, so a new agent release needs
// no change in build-tools or in the backend, while the package keeps its library at this path.

const PACKAGE_NAME = 'expo-emulator-capture';
/**
 * `eas/start_android_emulator` sets this job env variable to the requested agent version. The
 * session host rejects it in every session type except web preview, the only one that runs an
 * expo-device-hub version that can use the capture for now.
 */
export const EMULATOR_CAPTURE_REQUESTED_ENV = 'EAS_EXPERIMENTAL_EMULATOR_CAPTURE_VERSION';
const LINUX_AGENT_LIBRARY = path.join(
  'node_modules',
  PACKAGE_NAME,
  'dist',
  'linux-x64',
  'libexpo_emulator_capture.so'
);
/**
 * An npm version, a simple range such as `0.1.x`, or a dist-tag: letters, digits, `.`, `_` and `-`.
 * It keeps out specs that install another package, such as `npm:`, `file:` or git URLs. eas-cli
 * and www check the same pattern.
 */
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;
/** The registry normally answers in seconds; a stalled install must not hold the emulator. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** The expo-emulator-capture version to preload, or undefined when the capture is off. */
export function parseExperimentalEmulatorCaptureVersionInput(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new UserError(
      'EAS_EMULATOR_CAPTURE_INVALID_VERSION',
      `experimental_emulator_capture_version must be an npm version or dist-tag of ${PACKAGE_NAME}, made of letters, digits, ".", "_" and "-".`
    );
  }
  return value;
}

/**
 * Installs the agent package and returns the path of its library. Returns undefined after a
 * warning when the agent cannot run on this host or the install fails. The emulator then starts
 * as it does without the capture.
 */
export async function installEmulatorCaptureAsync({
  version,
  env,
  logger,
}: {
  version: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<string | undefined> {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    logger.warn(
      `The experimental emulator capture runs only on Linux x86-64 hosts. The emulator starts without ${PACKAGE_NAME}.`
    );
    return undefined;
  }
  let directory: string;
  try {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-emulator-capture-package-'));
    logger.info(`Installing ${PACKAGE_NAME}@${version} for the experimental emulator capture.`);
    await installIsolatedNpmPackageAsync({
      packageSpec: `${PACKAGE_NAME}@${version}`,
      directory,
      npmCacheUrl: env.EAS_BUILD_NPM_CACHE_URL,
      pathEnv: env.PATH,
      logger,
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn(
      { err },
      `Could not install ${PACKAGE_NAME}@${version}. The emulator starts without it.`
    );
    return undefined;
  }
  const library = path.join(directory, LINUX_AGENT_LIBRARY);
  if (!fs.existsSync(library)) {
    logger.warn(
      `${PACKAGE_NAME}@${version} has no Linux x86-64 agent at ${library}. The emulator starts without it.`
    );
    return undefined;
  }
  return library;
}
