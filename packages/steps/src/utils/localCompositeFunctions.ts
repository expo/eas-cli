import {
  CompositeFunctionCatalog,
  CompositeFunctionConfig,
  CompositeFunctionConfigZ,
  LocalFunctionCatalog,
  LocalFunctionConfig,
  Step,
  isLegacyFunctionConfig,
} from '@expo/eas-build-job';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';

import { BuildConfigError } from '../errors';

// Local functions referenced via `uses: ./path` or `uses: ../path` in EAS workflows.
// Not supported in `.eas/build/*.yml` custom build configs.

const JOB_CONTEXT_INTERPOLATION_REGEXP = /\$\{\{(.+?)\}\}/;

function doesLocalFunctionPathRequireInterpolation(uses: string): boolean {
  return JOB_CONTEXT_INTERPOLATION_REGEXP.test(uses);
}

export function parseLocalFunctionPath(uses: string): string {
  const trimmed = uses.trim();
  // The local function catalog is built before the workflow runs, so a local function path must be
  // known statically.
  if (doesLocalFunctionPathRequireInterpolation(trimmed)) {
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

export function isLocalFunctionPath(uses: string): boolean {
  const trimmed = uses.trim();
  return trimmed.startsWith('./') || trimmed.startsWith('../');
}

export function getLocalFunctionCallWorkingDirectoryError(uses: string): string {
  return `"working_directory" is not supported on a step that calls a local function ("uses: ${uses.trim()}"). For a composite function, set "working_directory" on the steps inside it; for a single-step "command" function, change directories inside the command.`;
}

/** Loads only functions transitively referenced by `rootSteps`. Unreferenced files are ignored. */
export async function buildLocalFunctionCatalogFromStepsAsync({
  rootSteps,
  loadLocalFunction,
}: {
  rootSteps: readonly Step[];
  loadLocalFunction: (functionPath: string) => Promise<LocalFunctionConfig>;
}): Promise<LocalFunctionCatalog> {
  const catalog: LocalFunctionCatalog = {};
  await extendLocalFunctionCatalogFromStepsAsync({ catalog, rootSteps, loadLocalFunction });
  return catalog;
}

/** Extends `catalog` in place with functions transitively referenced by `rootSteps`. Skips paths already present. */
export async function extendLocalFunctionCatalogFromStepsAsync({
  catalog,
  rootSteps,
  loadLocalFunction,
}: {
  catalog: LocalFunctionCatalog;
  rootSteps: readonly Step[];
  loadLocalFunction: (functionPath: string) => Promise<LocalFunctionConfig>;
}): Promise<void> {
  const loadRecursiveAsync = async (functionPath: string): Promise<void> => {
    if (functionPath in catalog) {
      return;
    }

    const config = await loadLocalFunction(functionPath);
    catalog[functionPath] = config;

    // Single-step functions are leaves: they have no steps that could reference other functions.
    if (isLegacyFunctionConfig(config)) {
      return;
    }
    for (const nestedPath of collectLocalFunctionPathsFromSteps(config.runs.steps)) {
      await loadRecursiveAsync(nestedPath);
    }
  };

  for (const functionPath of collectLocalFunctionPathsFromSteps(rootSteps)) {
    await loadRecursiveAsync(functionPath);
  }
}

export function resolveLocalFunctionPath(projectRoot: string, functionPath: string): string {
  return path.resolve(projectRoot, functionPath);
}

/**
 * Resolves the `path` of a single-step local function against the function's own directory, the
 * way a `.eas/build` config resolves it against the config file. Shared by every loader so the
 * two cannot drift.
 */
export function resolveLegacyFunctionModulePath({
  projectRoot,
  functionPath,
  modulePath,
}: {
  projectRoot: string;
  functionPath: string;
  modulePath: string;
}): string {
  if (path.isAbsolute(modulePath)) {
    return modulePath;
  }
  return path.resolve(resolveLocalFunctionPath(projectRoot, functionPath), modulePath);
}

export interface LocalFunctionLogger {
  debug(message: string): void;
}

/**
 * Reads and validates the function.yml (or function.yaml) file of a local function.
 * `functionPath` is the normalized ref returned by {@link parseLocalFunctionPath}.
 */
export async function loadLocalFunctionConfigAsync(
  projectRoot: string,
  functionPath: string,
  { logger }: { logger?: LocalFunctionLogger } = {}
): Promise<CompositeFunctionConfig> {
  const resolvedPath = resolveLocalFunctionPath(projectRoot, functionPath);

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
        `Failed to read local composite function "${functionPath}" from ${absolutePath}`,
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
        `Failed to parse local composite function "${functionPath}" YAML at ${absolutePath}`,
        {
          cause: err as Error,
        }
      );
    }

    const result = CompositeFunctionConfigZ.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Invalid composite function "${functionPath}": ${z.prettifyError(result.error)}`
      );
    }

    logger?.debug(
      `Loaded local composite function "${functionPath}" from ${path.relative(projectRoot, absolutePath)}`
    );
    return result.data;
  }

  throw new Error(
    `Local composite function "${functionPath}" was referenced by a step but no such composite function exists. A local composite function is resolved from a "function.yml" (or "function.yaml") file at the referenced path relative to the EAS project root (e.g. "uses: ${functionPath}" resolves "${functionPath}/function.yml"). The recommended convention is to keep composite functions under ".eas/functions/<name>".`
  );
}

/** Loader for the lazy hook path: bound to a project root, passed to {@link StepsConfigParser}. */
export function createLocalFunctionLoader(
  projectRoot: string,
  { logger }: { logger?: LocalFunctionLogger } = {}
): (functionPath: string) => Promise<CompositeFunctionConfig> {
  return async functionPath =>
    await loadLocalFunctionConfigAsync(projectRoot, functionPath, { logger });
}

/** Builds the catalog of local functions transitively referenced by `rootSteps`, loading each from disk. */
export async function buildLocalFunctionCatalogAsync(
  projectRoot: string,
  { rootSteps, logger }: { rootSteps: readonly Step[]; logger?: LocalFunctionLogger }
): Promise<CompositeFunctionCatalog> {
  return await buildLocalFunctionCatalogFromStepsAsync({
    rootSteps,
    loadLocalFunction: createLocalFunctionLoader(projectRoot, { logger }),
  });
}

function collectLocalFunctionPathsFromSteps(steps: readonly Step[]): Set<string> {
  const paths = new Set<string>();
  for (const step of steps) {
    if (step.uses !== undefined && isLocalFunctionPath(step.uses)) {
      if (step.working_directory !== undefined) {
        throw new BuildConfigError(getLocalFunctionCallWorkingDirectoryError(step.uses));
      }
      paths.add(parseLocalFunctionPath(step.uses));
    }
  }
  return paths;
}
