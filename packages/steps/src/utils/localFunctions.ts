import {
  CompositeFunctionCatalog,
  CompositeFunctionConfig,
  LocalFunctionCatalog,
  LocalFunctionConfig,
  LocalFunctionConfigZ,
  Step,
  isLegacyFunctionConfig,
} from '@expo/eas-build-job';
import fs from 'fs-extra';
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
      `Local function path "${trimmed}" must not contain interpolation ("\${{ ... }}"). The "uses" path for a local function must be a static, literal path.`
    );
  }
  if (trimmed.includes('\\')) {
    throw new BuildConfigError(
      `Local function path "${trimmed}" must not contain backslashes. Use forward slashes as path separators.`
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
  return `"working_directory" is not supported on a step that calls a local composite function ("uses: ${uses.trim()}"). The call step expands away; set "working_directory" on the steps inside the composite function instead.`;
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
  const loadRecursiveAsync = async (
    functionPath: string,
    calledWithWorkingDirectory: boolean
  ): Promise<void> => {
    const alreadyLoaded = functionPath in catalog;
    const config = alreadyLoaded ? catalog[functionPath] : await loadLocalFunction(functionPath);

    // working_directory is invalid on composite calls. Shape is only known after load.
    if (calledWithWorkingDirectory && !isLegacyFunctionConfig(config)) {
      throw new BuildConfigError(getLocalFunctionCallWorkingDirectoryError(functionPath));
    }
    if (alreadyLoaded) {
      return;
    }
    catalog[functionPath] = config;

    if (isLegacyFunctionConfig(config)) {
      return;
    }
    for (const [nestedPath, nestedCalledWithWorkingDirectory] of collectLocalFunctionCallsFromSteps(
      config.runs.steps
    )) {
      await loadRecursiveAsync(nestedPath, nestedCalledWithWorkingDirectory);
    }
  };

  for (const [functionPath, calledWithWorkingDirectory] of collectLocalFunctionCallsFromSteps(
    rootSteps
  )) {
    await loadRecursiveAsync(functionPath, calledWithWorkingDirectory);
  }
}

export function resolveLocalFunctionPath(projectRoot: string, functionPath: string): string {
  return path.resolve(projectRoot, functionPath);
}

async function resolveAndValidateLegacyFunctionModulePathAsync({
  projectRoot,
  functionPath,
  modulePath,
}: {
  projectRoot: string;
  functionPath: string;
  modulePath: string;
}): Promise<string> {
  const resolvedModulePath = path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(resolveLocalFunctionPath(projectRoot, functionPath), modulePath);
  if (!(await fs.pathExists(resolvedModulePath))) {
    throw new Error(
      `Local function "${functionPath}" declares "path: ${modulePath}", but there is no such directory at ${resolvedModulePath}.`
    );
  }
  if (!(await fs.pathExists(path.join(resolvedModulePath, 'package.json')))) {
    throw new Error(
      `Local function "${functionPath}" declares "path: ${modulePath}", but the module directory ${resolvedModulePath} does not contain a package.json file.`
    );
  }
  return resolvedModulePath;
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
): Promise<LocalFunctionConfig> {
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
      throw new Error(`Failed to read local function "${functionPath}" from ${absolutePath}`, {
        cause: err as Error,
      });
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(rawContents);
    } catch (err) {
      throw new Error(`Failed to parse local function "${functionPath}" YAML at ${absolutePath}`, {
        cause: err as Error,
      });
    }

    const result = LocalFunctionConfigZ.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid local function "${functionPath}": ${z.prettifyError(result.error)}`);
    }

    const config = result.data;
    // Steps parser expects an absolute module path.
    if (isLegacyFunctionConfig(config) && config.path !== undefined) {
      config.path = await resolveAndValidateLegacyFunctionModulePathAsync({
        projectRoot,
        functionPath,
        modulePath: config.path,
      });
    }

    logger?.debug(
      `Loaded local function "${functionPath}" from ${path.relative(projectRoot, absolutePath)}`
    );
    return config;
  }

  throw new Error(
    `Local function "${functionPath}" was referenced by a step but no such local function exists. A local function is resolved from a "function.yml" (or "function.yaml") file at the referenced path relative to the EAS project root (e.g. "uses: ${functionPath}" resolves "${functionPath}/function.yml"). The recommended convention is to keep local functions under ".eas/functions/<name>".`
  );
}

/** Loader for the lazy hook path: bound to a project root, passed to {@link StepsConfigParser}. */
export function createLocalFunctionLoader(
  projectRoot: string,
  { logger }: { logger?: LocalFunctionLogger } = {}
): (functionPath: string) => Promise<LocalFunctionConfig> {
  return async functionPath =>
    await loadLocalFunctionConfigAsync(projectRoot, functionPath, { logger });
}

/** Builds the catalog of local functions transitively referenced by `rootSteps`, loading each from disk. */
export async function buildLocalFunctionCatalogAsync(
  projectRoot: string,
  { rootSteps, logger }: { rootSteps: readonly Step[]; logger?: LocalFunctionLogger }
): Promise<LocalFunctionCatalog> {
  return await buildLocalFunctionCatalogFromStepsAsync({
    rootSteps,
    loadLocalFunction: createLocalFunctionLoader(projectRoot, { logger }),
  });
}

// Deprecated aliases for the pre-rename "local composite function" API, published up to v21.8.0.
// The wrappers keep the composite-only contract of that API: a legacy command/path function fails
// to load, exactly like it failed CompositeFunctionConfigZ validation before the rename.

/** @deprecated Use `parseLocalFunctionPath`. */
export const parseLocalCompositeFunctionPath = parseLocalFunctionPath;

/** @deprecated Use `isLocalFunctionPath`. */
export const isLocalCompositeFunctionPath = isLocalFunctionPath;

/** @deprecated Use `getLocalFunctionCallWorkingDirectoryError`. */
export const getLocalCompositeFunctionCallWorkingDirectoryError =
  getLocalFunctionCallWorkingDirectoryError;

/** @deprecated Use `resolveLocalFunctionPath`. */
export const resolveLocalCompositeFunctionPath = resolveLocalFunctionPath;

/** @deprecated Use `LocalFunctionLogger`. */
export type LocalCompositeFunctionLogger = LocalFunctionLogger;

/** @deprecated Use `loadLocalFunctionConfigAsync`, which also loads legacy command/path functions. */
export async function loadLocalCompositeFunctionConfigAsync(
  projectRoot: string,
  compositeFunctionPath: string,
  { logger }: { logger?: LocalCompositeFunctionLogger } = {}
): Promise<CompositeFunctionConfig> {
  const config = await loadLocalFunctionConfigAsync(projectRoot, compositeFunctionPath, { logger });
  if (isLegacyFunctionConfig(config)) {
    throw new Error(
      `Local function "${compositeFunctionPath}" declares "command" or "path". Use loadLocalFunctionConfigAsync to load legacy functions.`
    );
  }
  return config;
}

/** @deprecated Use `createLocalFunctionLoader`, which also loads legacy command/path functions. */
export function createLocalCompositeFunctionLoader(
  projectRoot: string,
  { logger }: { logger?: LocalCompositeFunctionLogger } = {}
): (compositeFunctionPath: string) => Promise<CompositeFunctionConfig> {
  return async compositeFunctionPath =>
    await loadLocalCompositeFunctionConfigAsync(projectRoot, compositeFunctionPath, { logger });
}

/** @deprecated Use `buildLocalFunctionCatalogFromStepsAsync`. */
export async function buildCompositeFunctionCatalogFromStepsAsync({
  rootSteps,
  loadCompositeFunction,
}: {
  rootSteps: readonly Step[];
  loadCompositeFunction: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
}): Promise<CompositeFunctionCatalog> {
  const catalog: CompositeFunctionCatalog = {};
  await extendLocalFunctionCatalogFromStepsAsync({
    catalog,
    rootSteps,
    loadLocalFunction: loadCompositeFunction,
  });
  return catalog;
}

/** @deprecated Use `extendLocalFunctionCatalogFromStepsAsync`. */
export async function extendCompositeFunctionCatalogFromStepsAsync({
  catalog,
  rootSteps,
  loadCompositeFunction,
}: {
  catalog: CompositeFunctionCatalog;
  rootSteps: readonly Step[];
  loadCompositeFunction: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
}): Promise<void> {
  await extendLocalFunctionCatalogFromStepsAsync({
    catalog,
    rootSteps,
    loadLocalFunction: loadCompositeFunction,
  });
}

/** @deprecated Use `buildLocalFunctionCatalogAsync`, which also loads legacy command/path functions. */
export async function buildLocalCompositeFunctionCatalogAsync(
  projectRoot: string,
  { rootSteps, logger }: { rootSteps: readonly Step[]; logger?: LocalCompositeFunctionLogger }
): Promise<CompositeFunctionCatalog> {
  return await buildCompositeFunctionCatalogFromStepsAsync({
    rootSteps,
    loadCompositeFunction: createLocalCompositeFunctionLoader(projectRoot, { logger }),
  });
}

function collectLocalFunctionCallsFromSteps(steps: readonly Step[]): Map<string, boolean> {
  const calledWithWorkingDirectoryByPath = new Map<string, boolean>();
  for (const step of steps) {
    if (step.uses !== undefined && isLocalFunctionPath(step.uses)) {
      const functionPath = parseLocalFunctionPath(step.uses);
      calledWithWorkingDirectoryByPath.set(
        functionPath,
        (calledWithWorkingDirectoryByPath.get(functionPath) ?? false) ||
          step.working_directory !== undefined
      );
    }
  }
  return calledWithWorkingDirectoryByPath;
}
