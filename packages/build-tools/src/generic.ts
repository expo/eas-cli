import { BuildPhase, Generic } from '@expo/eas-build-job';
import { Result, asyncResult } from '@expo/results';
import { BuildStepGlobalContext, BuildWorkflow, StepsConfigParser, errors } from '@expo/steps';
import fs from 'fs/promises';
import nullthrows from 'nullthrows';

import { prepareProjectSourcesAsync } from './common/projectSources';
import { BuildContext } from './context';
import { CustomBuildContext } from './customBuildContext';
import { getEasFunctionGroups } from './steps/easFunctionGroups';
import { getEasFunctions } from './steps/easFunctions';
import { uploadJobOutputsToWwwAsync } from './utils/outputs';
import { retryAsync } from './utils/retry';

export async function runGenericJobAsync(
  ctx: BuildContext<Generic.Job>
): Promise<{ runResult: Result<void>; buildWorkflow: BuildWorkflow }> {
  // expoApiV2BaseUrl is empty when running a local build, but generic jobs
  // are never executed locally, so it is always present here.
  const expoApiV2BaseUrl = nullthrows(
    ctx.expoApiV2BaseUrl,
    'expoApiV2BaseUrl is required for generic jobs'
  );

  const customBuildCtx = new CustomBuildContext(ctx);

  await ctx.runBuildPhase(BuildPhase.PREPARE_PROJECT, async () => {
    await retryAsync(
      async () => {
        await fs.rm(customBuildCtx.projectSourceDirectory, { recursive: true, force: true });
        await fs.mkdir(customBuildCtx.projectSourceDirectory, { recursive: true });

        await prepareProjectSourcesAsync(ctx, customBuildCtx.projectSourceDirectory);
      },
      {
        retryOptions: {
          retries: 3,
          retryIntervalMs: 1_000,
        },
      }
    );
  });

  const globalContext = new BuildStepGlobalContext(customBuildCtx, false);

  const parser = new StepsConfigParser(globalContext, {
    externalFunctions: getEasFunctions(customBuildCtx),
    externalFunctionGroups: getEasFunctionGroups(customBuildCtx),
    steps: ctx.job.steps,
  });

  const workflow = await ctx.runBuildPhase(BuildPhase.PARSE_CUSTOM_WORKFLOW_CONFIG, async () => {
    try {
      return await parser.parseAsync();
    } catch (parseError: any) {
      ctx.logger.error('Failed to parse the job definition file.');
      if (parseError instanceof errors.BuildWorkflowError) {
        for (const err of parseError.errors) {
          ctx.logger.error({ err });
        }
      }
      throw parseError;
    }
  });

  const runResult = await asyncResult(workflow.executeAsync());

  await ctx.runBuildPhase(BuildPhase.COMPLETE_JOB, async () => {
    const results = await Promise.allSettled([
      uploadJobOutputsToWwwAsync(globalContext, {
        logger: ctx.logger,
        expoApiV2BaseUrl,
      }),
      customBuildCtx.drainPendingMetricUploads(),
    ]);
    if (results[0].status === 'rejected') {
      throw results[0].reason;
    }
  });

  return { runResult, buildWorkflow: workflow };
}
