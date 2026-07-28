import { BuildJob, Env, Job, JobInterpolationContext } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildStepGlobalContext, hashFiles as hashFilePaths, jsepEval } from '@expo/steps';
import fg from 'fast-glob';
import path from 'path';

import { BuildContext } from '../context';
import { turtleFetch } from './turtleFetch';

export async function uploadJobOutputsToWwwAsync(
  ctx: BuildStepGlobalContext,
  { logger, expoApiV2BaseUrl }: { logger: bunyan; expoApiV2BaseUrl?: string }
): Promise<void> {
  await uploadJobOutputsWithInterpolationContextAsync({
    job: ctx.staticContext.job,
    env: ctx.env as Env,
    interpolationContext: ctx.getInterpolationContext(),
    logger,
    expoApiV2BaseUrl,
  });
}

export async function uploadJobOutputsFromBuildContextAsync<TJob extends BuildJob>(
  ctx: BuildContext<TJob>,
  { logger, buildSucceeded }: { logger: bunyan; buildSucceeded: boolean }
): Promise<void> {
  await uploadJobOutputsWithInterpolationContextAsync({
    job: ctx.job,
    env: ctx.env,
    interpolationContext: createBuildJobInterpolationContext(ctx, { buildSucceeded }),
    logger,
    expoApiV2BaseUrl: ctx.expoApiV2BaseUrl,
  });
}

async function uploadJobOutputsWithInterpolationContextAsync({
  job,
  env,
  interpolationContext,
  logger,
  expoApiV2BaseUrl,
}: {
  job: Job;
  env: Env;
  interpolationContext: JobInterpolationContext;
  logger: bunyan;
  expoApiV2BaseUrl?: string;
}): Promise<void> {
  if (!job.outputs) {
    logger.info('Job defines no outputs, skipping upload');
    return;
  }
  if (!expoApiV2BaseUrl) {
    logger.info('API V2 base URL is not available, skipping outputs upload');
    return;
  }
  const workflowJobId = env.__WORKFLOW_JOB_ID;
  if (!workflowJobId) {
    logger.info('Workflow job ID is not available, skipping outputs upload');
    return;
  }
  const robotAccessToken = job.secrets?.robotAccessToken;
  if (!robotAccessToken) {
    logger.info('Robot access token is not available, skipping outputs upload');
    return;
  }

  try {
    logger.debug({ dynamicValues: interpolationContext }, 'Using dynamic values');

    const outputs = collectJobOutputs({
      jobOutputDefinitions: job.outputs,
      interpolationContext,
    });
    logger.info('Uploading outputs');

    await turtleFetch(new URL(`workflows/${workflowJobId}`, expoApiV2BaseUrl).toString(), 'PATCH', {
      json: { outputs },
      headers: {
        Authorization: `Bearer ${robotAccessToken}`,
      },
      timeout: 20000,
      logger,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to upload outputs');
    throw err;
  }
}

function createBuildJobInterpolationContext<TJob extends BuildJob>(
  ctx: BuildContext<TJob>,
  { buildSucceeded }: { buildSucceeded: boolean }
): JobInterpolationContext {
  return {
    ...ctx.job.workflowInterpolationContext,
    expoApiServerURL: ctx.env.__API_SERVER_URL,
    job: ctx.job,
    metadata: ctx.metadata ?? null,
    steps: {},
    always: () => true,
    never: () => false,
    success: () => buildSucceeded,
    failure: () => !buildSucceeded,
    env: ctx.env,
    fromJSON: (json: string) => JSON.parse(json),
    toJSON: (value: unknown) => JSON.stringify(value),
    contains: (value, substring) => value.includes(substring),
    startsWith: (value, prefix) => value.startsWith(prefix),
    endsWith: (value, suffix) => value.endsWith(suffix),
    hashFiles: (...patterns: string[]) => hashFiles(ctx.getReactNativeProjectDirectory(), patterns),
    replaceAll: (input: string, stringToReplace: string, replacementString: string) => {
      while (input.includes(stringToReplace)) {
        input = input.replace(stringToReplace, replacementString);
      }
      return input;
    },
    substring: (input: string, start: number, end?: number) => input.substring(start, end),
  };
}

function hashFiles(cwd: string, patterns: string[]): string {
  const workspacePath = path.resolve(cwd);
  const filePaths = fg.sync(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
  });
  if (filePaths.length === 0) {
    return '';
  }

  const validFilePaths = filePaths.filter(file => file.startsWith(`${workspacePath}${path.sep}`));
  if (validFilePaths.length === 0) {
    return '';
  }

  return hashFilePaths(validFilePaths);
}

/** Function we use to get outputs of the whole job from steps. */
export function collectJobOutputs({
  jobOutputDefinitions,
  interpolationContext,
}: {
  jobOutputDefinitions: Record<string, string>;
  interpolationContext: JobInterpolationContext;
}): Record<string, string | undefined> {
  const jobOutputs: Record<string, string | undefined> = {};
  for (const [outputKey, outputDefinition] of Object.entries(jobOutputDefinitions)) {
    const outputValue = outputDefinition.replace(/\$\{\{(.+?)\}\}/g, (_match, expression) => {
      return `${jsepEval(expression, interpolationContext) ?? ''}`;
    });

    jobOutputs[outputKey] = outputValue;
  }

  return jobOutputs;
}
