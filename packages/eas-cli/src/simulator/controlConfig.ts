import Ajv2020, { AnySchema } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import * as fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';

import {
  ControlActionResult,
  PreparedControlAction,
  executeControlActionAsync,
  prepareControlActionAsync,
} from './controlActions';
import { HostActionCatalog, HostActionConnection, createHostActionUploadId } from './hostActions';

const Config = z.strictObject({
  version: z.literal(1),
  actions: z
    .array(
      z.strictObject({
        action: z.string().min(1),
        params: z.record(z.string(), z.json()).default({}),
        file: z.string().min(1).optional(),
        output: z.string().min(1).optional(),
      })
    )
    .min(1),
});

type ConfigAction = {
  readonly plan: PreparedControlAction;
  readonly validateParams: (params: Record<string, unknown>) => void;
};

export type PreparedControlConfig = {
  readonly path: string;
  readonly udid: string;
  readonly actions: readonly ConfigAction[];
};

export type ControlConfigResult = ControlActionResult & { action: string };

export type ControlConfigProgress = {
  step: number;
  total: number;
  action: string;
} & ({ status: 'running' } | { status: 'completed'; result: ControlConfigResult });

export class ControlConfigExecutionError extends Error {
  constructor(
    readonly step: number,
    readonly action: string,
    readonly completed: readonly ControlConfigResult[],
    cause: unknown
  ) {
    super(
      `Config step ${step} (${action}) failed after ${completed.length} completed actions: ${errorMessage(cause)}`,
      { cause }
    );
    this.name = 'ControlConfigExecutionError';
  }
}

export async function prepareControlConfigAsync(
  catalog: HostActionCatalog,
  filePath: string,
  udid: string
): Promise<PreparedControlConfig> {
  const absolutePath = path.resolve(filePath);
  let input: unknown;
  try {
    input = await fs.readJson(absolutePath);
  } catch (error) {
    throw new Error(
      `Could not read simulator configuration ${absolutePath}: ${errorMessage(error)}`,
      {
        cause: error,
      }
    );
  }
  const parsed = Config.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid simulator configuration ${absolutePath}: ${detail}`);
  }

  const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
  const actions: ConfigAction[] = [];
  for (const [index, action] of parsed.data.actions.entries()) {
    try {
      if (Object.hasOwn(action.params, 'udid')) {
        throw new Error('The simulator is selected by the session; remove params.udid.');
      }
      const plan = await prepareControlActionAsync(
        catalog,
        { ...action, outputPath: action.output },
        { localFileMode: 'explicit', baseDir: path.dirname(absolutePath) }
      );
      if (plan.entry.output) {
        if (!plan.outputPath) {
          throw new Error('Set output to a file or directory for this action.');
        }
        await assertWritableOutputAsync(plan.outputPath);
      }
      assertUnambiguousFileSource(ajv, plan, udid);
      const validate = ajv.compile(plan.entry as AnySchema);
      const validateParams = (params: Record<string, unknown>): void => {
        if (!validate({ ...params, udid })) {
          throw new Error(ajv.errorsText(validate.errors, { dataVar: 'params' }));
        }
      };
      const params = { ...plan.params };
      if (plan.localFile) {
        const uploadId = createHostActionUploadId(plan.localFile.path);
        params[plan.localFile.param] =
          plan.entry.uploadAs === 'id' ? uploadId : `/tmp/serve-sim-uploads/${uploadId}`;
      }
      validateParams(params);
      actions.push(Object.freeze({ plan, validateParams }));
    } catch (error) {
      throw new Error(`Config step ${index + 1} (${action.action}): ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }
  return Object.freeze({ path: absolutePath, udid, actions: Object.freeze(actions) });
}

async function assertWritableOutputAsync(outputPath: string): Promise<void> {
  const stat = await fs.stat(outputPath).catch(() => null);
  if (stat && !stat.isFile() && !stat.isDirectory()) {
    throw new Error(`${outputPath} must be a regular file or directory.`);
  }
  await fs.access(
    stat ? outputPath : path.dirname(outputPath),
    fs.constants.W_OK | (stat?.isFile() ? 0 : fs.constants.X_OK)
  );
}

function declaresParameter(schema: unknown, name: string): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return false;
  }
  const { properties, allOf } = schema as { properties?: object; allOf?: unknown[] };
  return (
    (properties !== undefined && Object.hasOwn(properties, name)) ||
    (Array.isArray(allOf) && allOf.some(child => declaresParameter(child, name)))
  );
}

function assertUnambiguousFileSource(
  ajv: Ajv2020,
  plan: PreparedControlAction,
  udid: string
): void {
  if (!plan.localFile) {
    return;
  }
  const { anyOf, oneOf, ...common } = plan.entry;
  for (const branch of anyOf ?? oneOf ?? []) {
    if (declaresParameter(branch, plan.localFile.param)) {
      continue;
    }
    const validate = ajv.compile({
      ...common,
      allOf: [...(common.allOf ?? []), branch],
    } as AnySchema);
    if (validate({ ...plan.params, udid })) {
      throw new Error('file conflicts with another source in params. Supply only one file source.');
    }
  }
}

export async function executeControlConfigAsync(
  connection: HostActionConnection,
  config: PreparedControlConfig,
  { onProgress }: { onProgress?: (progress: ControlConfigProgress) => void } = {}
): Promise<ControlConfigResult[]> {
  if (config.udid !== connection.udid) {
    throw new Error('The simulator changed after this configuration was checked. Import it again.');
  }
  const completed: ControlConfigResult[] = [];
  for (const [index, { plan, validateParams }] of config.actions.entries()) {
    const progress = { step: index + 1, total: config.actions.length, action: plan.action };
    onProgress?.({ ...progress, status: 'running' });
    let result: ControlActionResult;
    try {
      result = await executeControlActionAsync(connection, plan, { validateParams });
    } catch (error) {
      throw new ControlConfigExecutionError(index + 1, plan.action, completed, error);
    }
    const entry = { action: plan.action, ...result };
    completed.push(entry);
    onProgress?.({ ...progress, status: 'completed', result: entry });
  }
  return completed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
