import path from 'path';

import { BuildConfigError } from '../errors';

// Local composite actions referenced via `uses: ./path` or `uses: ../path` in EAS workflows.
// Not supported in `.eas/build/*.yml` custom build configs.

const JOB_CONTEXT_INTERPOLATION_REGEXP = /\$\{\{(.+?)\}\}/;

function actionPathIsInterpolated(uses: string): boolean {
  return JOB_CONTEXT_INTERPOLATION_REGEXP.test(uses);
}

export function parseActionPath(uses: string): string {
  const trimmed = uses.trim();
  // The action catalog is built before the workflow runs, so a local action path must be
  // known statically.
  if (actionPathIsInterpolated(trimmed)) {
    throw new BuildConfigError(
      `Local action path "${trimmed}" must not contain interpolation ("\${{ ... }}"). The "uses" path for a local action must be a static, literal path.`
    );
  }
  if (trimmed.includes('\\')) {
    throw new BuildConfigError(
      `Local action path "${trimmed}" must not contain backslashes. Use forward slashes as path separators.`
    );
  }
  const normalized = path.posix.normalize(trimmed.replace(/\/+$/, ''));
  if (normalized === '.' || normalized === '..') {
    throw new BuildConfigError(
      `Local action path "${trimmed}" does not point to an action directory.`
    );
  }
  return normalized.startsWith('../') ? normalized : `./${normalized}`;
}

export function isActionPath(uses: string): boolean {
  const trimmed = uses.trim();
  return trimmed.startsWith('./') || trimmed.startsWith('../');
}
