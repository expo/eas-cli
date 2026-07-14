import path from 'path';

import { BuildConfigError } from '../errors';

// Local composite functions referenced via `uses: ./path` or `uses: ../path` in EAS workflows.
// Not supported in `.eas/build/*.yml` custom build configs.

const JOB_CONTEXT_INTERPOLATION_REGEXP = /\$\{\{(.+?)\}\}/;

function localCompositeFunctionPathIsInterpolated(uses: string): boolean {
  return JOB_CONTEXT_INTERPOLATION_REGEXP.test(uses);
}

export function parseLocalCompositeFunctionPath(uses: string): string {
  const trimmed = uses.trim();
  // The composite function catalog is built before the workflow runs, so a local path must be
  // known statically.
  if (localCompositeFunctionPathIsInterpolated(trimmed)) {
    throw new BuildConfigError(
      `Local composite function path "${trimmed}" must not contain interpolation ("\${{ ... }}"). The "uses" path for a local composite function must be a static, literal path.`
    );
  }
  if (trimmed.includes('\\')) {
    throw new BuildConfigError(
      `Local composite function path "${trimmed}" must not contain backslashes. Use forward slashes as path separators.`
    );
  }
  const normalized = path.posix.normalize(trimmed.replace(/\/+$/, ''));
  if (normalized === '.' || normalized === '..') {
    throw new BuildConfigError(
      `Local composite function path "${trimmed}" does not point to a composite function directory.`
    );
  }
  return normalized.startsWith('../') ? normalized : `./${normalized}`;
}

export function isLocalCompositeFunctionPath(uses: string): boolean {
  const trimmed = uses.trim();
  return trimmed.startsWith('./') || trimmed.startsWith('../');
}

export function getLocalCompositeFunctionCallWorkingDirectoryError(uses: string): string {
  return `"working_directory" is not supported on a step that calls a local composite function ("uses: ${uses.trim()}"). Set "working_directory" on the steps inside the composite function instead.`;
}
