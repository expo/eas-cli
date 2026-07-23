import { CompositeFunctionConfig, CompositeFunctionConfigZ } from '@expo/eas-build-job';
import {
  buildCompositeFunctionCatalogFromStepsAsync,
  resolveLocalCompositeFunctionPath,
} from '@expo/steps';
import { promises as fs } from 'fs';
import path from 'path';
import * as YAML from 'yaml';
import { z } from 'zod';

import Log from '../../log';

const COMPOSITE_FUNCTION_FILE_EXTENSIONS = ['yml', 'yaml'] as const;

export async function validateWorkflowLocalCompositeFunctionsAsync(
  parsedYaml: any,
  projectDir: string
): Promise<void> {
  await buildCompositeFunctionCatalogFromStepsAsync({
    rootSteps: stepsFromWorkflow(parsedYaml),
    loadCompositeFunction: compositeFunctionPath =>
      loadLocalCompositeFunctionConfigAsync(projectDir, compositeFunctionPath),
  });
}

async function loadLocalCompositeFunctionConfigAsync(
  projectDir: string,
  compositeFunctionPath: string
): Promise<CompositeFunctionConfig> {
  const resolvedPath = resolveLocalCompositeFunctionPath(projectDir, compositeFunctionPath);

  for (const ext of COMPOSITE_FUNCTION_FILE_EXTENSIONS) {
    const config = await readCompositeFunctionConfigFileAsync(
      compositeFunctionPath,
      path.join(resolvedPath, `function.${ext}`)
    );
    if (config) {
      Log.debug(`Validated local composite function "${compositeFunctionPath}"`);
      return config;
    }
  }

  throw new Error(
    `Local composite function "${compositeFunctionPath}" was referenced by a step but no such composite function exists. A local composite function is resolved from a "function.yml" (or "function.yaml") file at the referenced path relative to the EAS project root (e.g. "uses: ${compositeFunctionPath}" resolves "${compositeFunctionPath}/function.yml"). The recommended convention is to keep composite functions under ".eas/functions/<name>".`
  );
}

async function readCompositeFunctionConfigFileAsync(
  compositeFunctionPath: string,
  absolutePath: string
): Promise<CompositeFunctionConfig | null> {
  let rawContents: string;
  try {
    rawContents = await fs.readFile(absolutePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
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

  return result.data;
}

function stepsFromWorkflow(parsedYaml: any): any[] {
  const jobs = parsedYaml?.jobs;
  if (!jobs || typeof jobs !== 'object') {
    return [];
  }
  return Object.values(jobs).flatMap((job: any) => [
    ...(Array.isArray(job?.steps) ? job.steps : []),
    ...hookStepsFromJob(job),
  ]);
}

// All hook keys, not only ones this CLI registers: file existence cannot version-skew false-fail.
function hookStepsFromJob(job: any): any[] {
  const hooks = job?.hooks;
  if (!hooks || typeof hooks !== 'object') {
    return [];
  }
  return Object.values(hooks).flatMap((steps: any) => (Array.isArray(steps) ? steps : []));
}
