import { BuildPhase, Generic } from '@expo/eas-build-job';
import { Result, asyncResult } from '@expo/results';
import { BuildStepGlobalContext, BuildWorkflow, StepsConfigParser, errors } from '@expo/steps';
import fs from 'fs/promises';

import { prepareProjectSourcesAsync } from './common/projectSources';
import { BuildContext } from './context';
import { CustomBuildContext } from './customBuildContext';
import { getEasFunctionGroups } from './steps/easFunctionGroups';
import { getEasFunctions } from './steps/easFunctions';
import { uploadJobOutputsToWwwAsync } from './utils/outputs';
import { retryAsync } from './utils/retry';
import { uploadStepMetricToWwwAsync } from './utils/stepMetrics';

export async function runGenericJobAsync(
  ctx: BuildContext<Generic.Job>,
  { expoApiV2BaseUrl }: { expoApiV2BaseUrl: string }
): Promise<{ runResult: Result<void>; buildWorkflow: BuildWorkflow }> {
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

  const workflowJobId = customBuildCtx.env.__WORKFLOW_JOB_ID;
  const robotAccessToken = ctx.job.secrets?.robotAccessToken;
  const pendingMetricUploads: Promise<void>[] = [];

  if (workflowJobId && robotAccessToken) {
    globalContext.onStepMetricCollected = metric => {
      const p = uploadStepMetricToWwwAsync({
        workflowJobId,
        robotAccessToken,
        expoApiV2BaseUrl,
        stepMetric: metric,
        logger: ctx.logger,
      });
      pendingMetricUploads.push(p);
    };
  }

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
    try {
      await uploadJobOutputsToWwwAsync(globalContext, {
        logger: ctx.logger,
        expoApiV2BaseUrl,
      });
    } finally {
      // Drain any in-flight metric uploads before the worker exits.
      // Uploads run concurrently with step execution, so in practice most
      // are already settled by this point. This only blocks if the last
      // step's upload is still in-flight.
      // In a finally block so drain runs even if outputs upload fails.
      await Promise.allSettled(pendingMetricUploads);
    }
  });

  return { runResult, buildWorkflow: workflow };
}
