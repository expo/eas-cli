import { JobInterpolationContext } from '@expo/eas-build-job';
import { BuildStepGlobalContext, jsepEval } from '@expo/steps';
import { bunyan } from '@expo/logger';
import nullthrows from 'nullthrows';

import { turtleFetch } from './turtleFetch';

export async function uploadJobOutputsToWwwAsync(
  ctx: BuildStepGlobalContext,
  { logger, expoApiV2BaseUrl }: { logger: bunyan; expoApiV2BaseUrl: string }
): Promise<void> {
  if (!ctx.staticContext.job.outputs) {
    logger.info('Job defines no outputs, skipping upload');
    return;
  }

  try {
    const workflowJobId = nullthrows(ctx.env.__WORKFLOW_JOB_ID);
    const robotAccessToken = nullthrows(ctx.staticContext.job.secrets?.robotAccessToken);

    const interpolationContext = ctx.getInterpolationContext();
    logger.debug({ dynamicValues: interpolationContext }, 'Using dynamic values');

    const outputs = collectJobOutputs({
      jobOutputDefinitions: ctx.staticContext.job.outputs,
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
