import fs from 'fs/promises';

import { BuildPhase, Generic } from '@expo/eas-build-job';
import { BuildStepGlobalContext, BuildWorkflow, errors, StepsConfigParser } from '@expo/steps';
import { Result, asyncResult } from '@expo/results';

import { BuildContext } from './context';
import { prepareProjectSourcesAsync } from './common/projectSources';
import { getEasFunctions } from './steps/easFunctions';
import { CustomBuildContext } from './customBuildContext';
import { getEasFunctionGroups } from './steps/easFunctionGroups';
import { uploadJobOutputsToWwwAsync } from './utils/outputs';
import { retryAsync } from './utils/retry';
import { uploadStepMetricsToWwwAsync } from './utils/stepMetrics';

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
    await uploadJobOutputsToWwwAsync(globalContext, {
      logger: ctx.logger,
      expoApiV2BaseUrl,
    });

    const workflowJobId = globalContext.env.__WORKFLOW_JOB_ID;
    const robotAccessToken = ctx.job.secrets?.robotAccessToken;

    if (workflowJobId && robotAccessToken) {
      await uploadStepMetricsToWwwAsync({
        workflowJobId,
        robotAccessToken,
        expoApiV2BaseUrl,
        stepMetrics: globalContext.stepMetrics,
        logger: ctx.logger,
      });
    }
  });

  return { runResult, buildWorkflow: workflow };
}
