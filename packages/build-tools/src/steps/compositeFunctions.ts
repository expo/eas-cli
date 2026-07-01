/**
 * Loads local function.yml files from the project and builds the catalog consumed by
 * {@link StepsConfigParser}. Keeps filesystem I/O in build-tools; expansion logic lives in @expo/steps.
 */
import { bunyan } from '@expo/logger';
import {
  CompositeFunctionCatalog,
  CompositeFunctionConfig,
  CompositeFunctionConfigZ,
} from '@expo/eas-build-job';
import {
  buildCompositeFunctionCatalogFromStepsAsync,
  resolveLocalCompositeFunctionPath,
} from '@expo/steps';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { ZodError, z } from 'zod';

async function loadLocalCompositeFunctionConfigAsync(
  projectRoot: string,
  compositeFunctionPath: string,
  { logger }: { logger?: bunyan } = {}
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
    let config: CompositeFunctionConfig;
    try {
      config = CompositeFunctionConfigZ.parse(parsed);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(
          `Invalid composite function "${compositeFunctionPath}": ${z.prettifyError(err)}`
        );
      }
      throw err;
    }
    logger?.debug(
      `Loaded local composite function "${compositeFunctionPath}" from ${path.relative(projectRoot, absolutePath)}`
    );
    return config;
  }

  throw new Error(
    `Local composite function "${compositeFunctionPath}" was referenced by a step but no such composite function exists. A local composite function is resolved from a "function.yml" (or "function.yaml") file at the referenced path relative to the EAS project root (e.g. "uses: ${compositeFunctionPath}" resolves "${compositeFunctionPath}/function.yml"). The recommended convention is to keep composite functions under ".eas/functions/<name>".`
  );
}

export async function buildCompositeFunctionCatalogAsync(
  projectRoot: string,
  { steps, logger }: { steps: readonly unknown[]; logger?: bunyan }
): Promise<CompositeFunctionCatalog> {
  return buildCompositeFunctionCatalogFromStepsAsync({
    rootSteps: steps,
    loadCompositeFunction: compositeFunctionPath =>
      loadLocalCompositeFunctionConfigAsync(projectRoot, compositeFunctionPath, { logger }),
  });
}
