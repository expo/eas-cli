import {
  CompositeFunctionCatalog,
  CompositeFunctionConfig,
  CompositeFunctionConfigZ,
  LocalFunctionCatalog,
  Step,
} from '@expo/eas-build-job';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';

import { BuildConfigError } from '../errors';

// Local composite functions referenced via `uses: ./path` or `uses: ../path` in EAS workflows.
// Not supported in `.eas/build/*.yml` custom build configs.

const JOB_CONTEXT_INTERPOLATION_REGEXP = /\$\{\{(.+?)\}\}/;

function doesLocalCompositeFunctionPathRequireInterpolation(uses: string): boolean {
  return JOB_CONTEXT_INTERPOLATION_REGEXP.test(uses);
}

export function parseLocalCompositeFunctionPath(uses: string): string {
  const trimmed = uses.trim();
  // The composite function catalog is built before the workflow runs, so a local composite function path must be
  // known statically.
  if (doesLocalCompositeFunctionPathRequireInterpolation(trimmed)) {
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
  if (normalized === '..' || normalized.startsWith('../')) {
    return normalized;
  }
  return `./${normalized}`;
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
  rootSteps: readonly Step[];
  loadCompositeFunction: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
}): Promise<CompositeFunctionCatalog> {
  const catalog: CompositeFunctionCatalog = {};
  await extendCompositeFunctionCatalogFromStepsAsync({ catalog, rootSteps, loadCompositeFunction });
  return catalog;
}

/** Extends `catalog` in place with functions transitively referenced by `rootSteps`. Skips paths already present. */
export async function extendCompositeFunctionCatalogFromStepsAsync({
  catalog,
  rootSteps,
  loadCompositeFunction,
}: {
  catalog: LocalFunctionCatalog;
  rootSteps: readonly Step[];
  loadCompositeFunction: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
}): Promise<void> {
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
}

export function resolveLocalCompositeFunctionPath(
  projectRoot: string,
  compositeFunctionPath: string
): string {
  return path.resolve(projectRoot, compositeFunctionPath);
}

export interface LocalCompositeFunctionLogger {
  debug(message: string): void;
}

/**
 * Reads and validates the function.yml (or function.yaml) file of a local composite function.
 * `compositeFunctionPath` is the normalized ref returned by {@link parseLocalCompositeFunctionPath}.
 */
export async function loadLocalCompositeFunctionConfigAsync(
  projectRoot: string,
  compositeFunctionPath: string,
  { logger }: { logger?: LocalCompositeFunctionLogger } = {}
): Promise<CompositeFunctionConfig> {
  const resolvedPath = resolveLocalCompositeFunctionPath(projectRoot, compositeFunctionPath);

  for (const ext of ['yml', 'yaml'] as const) {
    const absolutePath = path.join(resolvedPath, `function.${ext}`);
    let rawContents: string;
    try {
      rawContents = await fs.readFile(absolutePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        continue;
      }
      throw new Error(
        `Failed to read local composite function "${compositeFunctionPath}" from ${absolutePath}`,
        {
          cause: err as Error,
        }
      );
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(rawContents);
    } catch (err) {
      throw new Error(
        `Failed to parse local composite function "${compositeFunctionPath}" YAML at ${absolutePath}`,
        {
          cause: err as Error,
        }
      );
    }

    const result = CompositeFunctionConfigZ.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid composite function "${compositeFunctionPath}": ${z.prettifyError(result.error)}`
      );
    }

    logger?.debug(
      `Loaded local composite function "${compositeFunctionPath}" from ${path.relative(projectRoot, absolutePath)}`
    );
    return result.data;
  }

  throw new Error(
    `Local composite function "${compositeFunctionPath}" was referenced by a step but no such composite function exists. A local composite function is resolved from a "function.yml" (or "function.yaml") file at the referenced path relative to the EAS project root (e.g. "uses: ${compositeFunctionPath}" resolves "${compositeFunctionPath}/function.yml"). The recommended convention is to keep composite functions under ".eas/functions/<name>".`
  );
}

/** Loader for the lazy hook path: bound to a project root, passed to {@link StepsConfigParser}. */
export function createLocalCompositeFunctionLoader(
  projectRoot: string,
  { logger }: { logger?: LocalCompositeFunctionLogger } = {}
): (compositeFunctionPath: string) => Promise<CompositeFunctionConfig> {
  return async compositeFunctionPath =>
    await loadLocalCompositeFunctionConfigAsync(projectRoot, compositeFunctionPath, { logger });
}

/** Builds the catalog of composite functions transitively referenced by `rootSteps`, loading each from disk. */
export async function buildLocalCompositeFunctionCatalogAsync(
  projectRoot: string,
  { rootSteps, logger }: { rootSteps: readonly Step[]; logger?: LocalCompositeFunctionLogger }
): Promise<CompositeFunctionCatalog> {
  return await buildCompositeFunctionCatalogFromStepsAsync({
    rootSteps,
    loadCompositeFunction: createLocalCompositeFunctionLoader(projectRoot, { logger }),
  });
}

function collectLocalCompositeFunctionPathsFromSteps(steps: readonly Step[]): Set<string> {
  const paths = new Set<string>();
  for (const step of steps) {
    if (step.uses !== undefined && isLocalCompositeFunctionPath(step.uses)) {
      if (step.working_directory !== undefined) {
        throw new BuildConfigError(getLocalCompositeFunctionCallWorkingDirectoryError(step.uses));
      }
      paths.add(parseLocalCompositeFunctionPath(step.uses));
    }
  }
  return paths;
}
