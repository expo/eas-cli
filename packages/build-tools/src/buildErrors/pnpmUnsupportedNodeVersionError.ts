import { errors } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';
import semver from 'semver';

import { ErrorHandler } from './errors.types';

// example log: "warn: This version of pnpm requires at least Node.js v22.13" followed by "warn: The current version of Node.js is v20.19.4"
const PNPM_UNSUPPORTED_NODE_VERSION_REGEXP =
  /This version of pnpm requires at least Node\.js v([\d.]+)\n.*The current version of Node\.js is v([\d.]+)/;

function createPnpmUnsupportedNodeVersionError(matchResult: RegExpMatchArray): errors.UserError {
  const [, requiredNodeVersion, currentNodeVersion] = matchResult;
  const minimumNodeVersion = nullthrows(semver.coerce(requiredNodeVersion)).version;
  return new errors.UserError(
    'EAS_BUILD_PNPM_UNSUPPORTED_NODE_VERSION_ERROR',
    `This build uses a pnpm version that requires Node.js ${minimumNodeVersion} or newer, but runs Node.js ${currentNodeVersion}. You can fix it by either:
- setting "node" to "${minimumNodeVersion}" or a newer version in the build profile in eas.json
- using a pnpm version that supports Node.js ${currentNodeVersion}: change "packageManager" in package.json if your project sets it, and set "pnpm" in the build profile in eas.json`,
    { docsUrl: 'https://docs.expo.dev/eas/json/' }
  );
}

export const pnpmUnsupportedNodeVersionErrorHandler: ErrorHandler<errors.UserError> = {
  regexp: PNPM_UNSUPPORTED_NODE_VERSION_REGEXP,
  createError: createPnpmUnsupportedNodeVersionError,
};

export function detectPnpmUnsupportedNodeVersionError(
  output: string
): errors.UserError | undefined {
  const match = output.match(PNPM_UNSUPPORTED_NODE_VERSION_REGEXP);
  return match ? createPnpmUnsupportedNodeVersionError(match) : undefined;
}
