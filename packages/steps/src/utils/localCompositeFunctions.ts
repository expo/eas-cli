import { CompositeFunctionCatalog, CompositeFunctionConfig } from '@expo/eas-build-job';
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
  // The composite function catalog is built before the workflow runs, so a local composite function path must be
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

/** Loads only composite functions transitively referenced by `rootSteps`. Unreferenced files are ignored. */
export async function buildCompositeFunctionCatalogFromStepsAsync({
  rootSteps,
  loadCompositeFunction,
}: {
  rootSteps: readonly unknown[];
  loadCompositeFunction: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
}): Promise<CompositeFunctionCatalog> {
  const catalog: CompositeFunctionCatalog = {};

  const loadRecursiveAsync = async (compositeFunctionPath: string): Promise<void> => {
    if (compositeFunctionPath in catalog) {
      return;
    }

    const config = await loadCompositeFunction(compositeFunctionPath);
    catalog[compositeFunctionPath] = config;

    for (const nestedPath of collectLocalCompositeFunctionPathsFromSteps(config.runs.steps)) {
      await loadRecursiveAsync(nestedPath);
    }
  };

  for (const compositeFunctionPath of collectLocalCompositeFunctionPathsFromSteps(rootSteps)) {
    await loadRecursiveAsync(compositeFunctionPath);
  }

  return catalog;
}

export function resolveLocalCompositeFunctionPath(
  projectRoot: string,
  compositeFunctionPath: string
): string {
  return path.resolve(projectRoot, compositeFunctionPath);
}

function collectLocalCompositeFunctionPathsFromSteps(steps: readonly unknown[]): Set<string> {
  const paths = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      continue;
    }
    const uses = (step as { uses?: unknown }).uses;
    if (typeof uses === 'string' && isLocalCompositeFunctionPath(uses)) {
      if ((step as { working_directory?: unknown }).working_directory !== undefined) {
        throw new BuildConfigError(getLocalCompositeFunctionCallWorkingDirectoryError(uses));
      }
      paths.add(parseLocalCompositeFunctionPath(uses));
    }
  }
  return paths;
}
