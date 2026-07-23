import { BuildJob, BuildPhase, BuildTrigger, Ios, Platform } from '@expo/eas-build-job';
import {
  BuildConfigParser,
  BuildStepGlobalContext,
  BuildWorkflow,
  StepsConfigParser,
  errors,
} from '@expo/steps';
import assert from 'assert';
import fs from 'fs/promises';
import nullthrows from 'nullthrows';
import path from 'path';

import { resolveEnvFromBuildProfileAsync } from '../common/easBuildInternal';
import { prepareProjectSourcesAsync } from '../common/projectSources';
import { Artifacts, BuildContext } from '../context';
import { CustomBuildContext } from '../customBuildContext';
import { Datadog } from '../datadog';
import { findAndUploadXcodeBuildLogsAsync } from '../ios/xcodeBuildLogs';
import { buildCompositeFunctionCatalogAsync } from '../steps/compositeFunctions';
import { getEasFunctionGroups } from '../steps/easFunctionGroups';
import { getEasFunctions } from '../steps/easFunctions';
import { retryAsync } from '../utils/retry';

export async function runCustomBuildAsync(ctx: BuildContext<BuildJob>): Promise<Artifacts> {
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

  if (ctx.job.triggeredBy === BuildTrigger.GIT_BASED_INTEGRATION) {
    // We need to setup envs from eas.json
    const env = await resolveEnvFromBuildProfileAsync(ctx, {
      cwd: path.join(customBuildCtx.projectSourceDirectory, ctx.job.projectRootDirectory ?? '.'),
    });
    ctx.updateEnv(env);
    customBuildCtx.updateEnv(ctx.env);
  }

  assert(
    'steps' in ctx.job || 'customBuildConfig' in ctx.job,
    'Steps or custom build config path are required in custom jobs'
  );

  const globalContext = new BuildStepGlobalContext(customBuildCtx, false);
  const easFunctions = getEasFunctions(customBuildCtx);
  const easFunctionGroups = getEasFunctionGroups(customBuildCtx);
  const workflow = await ctx.runBuildPhase(BuildPhase.PARSE_CUSTOM_WORKFLOW_CONFIG, async () => {
    try {
      const parser = ctx.job.steps
        ? new StepsConfigParser(globalContext, {
            externalFunctions: easFunctions,
            externalFunctionGroups: easFunctionGroups,
            steps: ctx.job.steps,
            hooks: ctx.job.hooks,
            compositeFunctionCatalog: await buildCompositeFunctionCatalogAsync(
              ctx.getReactNativeProjectDirectory(customBuildCtx.projectSourceDirectory),
              { steps: ctx.job.steps, hooks: ctx.job.hooks, logger: ctx.logger }
            ),
          })
        : new BuildConfigParser(globalContext, {
            externalFunctions: easFunctions,
            externalFunctionGroups: easFunctionGroups,
            configPath: path.join(
              ctx.getReactNativeProjectDirectory(customBuildCtx.projectSourceDirectory),
              nullthrows(
                ctx.job.customBuildConfig?.path,
                'Steps or custom build config path are required in custom jobs'
              )
            ),
          });
      return await parser.parseAsync();
    } catch (parseError: any) {
      ctx.logger.error('Failed to parse the custom build config file.');
      if (parseError instanceof errors.BuildWorkflowError) {
        for (const err of parseError.errors) {
          ctx.logger.error({ err });
        }
      }
      throw parseError;
    }
  });
  logUserProvidedCustomFunctions(workflow);
  try {
    try {
      await workflow.executeAsync();
    } finally {
      if (!ctx.artifacts.XCODE_BUILD_LOGS && ctx.job.platform === Platform.IOS) {
        try {
          await findAndUploadXcodeBuildLogsAsync(ctx as BuildContext<Ios.Job>, {
            logger: ctx.logger,
          });
        } catch {
          // do nothing, it's a non-breaking error.
        }
      }
      await customBuildCtx.drainPendingMetricUploads();
    }
  } catch (err: any) {
    err.artifacts = ctx.artifacts;
    throw err;
  }

  return ctx.artifacts;
}

function logUserProvidedCustomFunctions(workflow: BuildWorkflow): void {
  for (const buildFunction of Object.values(workflow.buildFunctions)) {
    if (!buildFunction.customFunctionModulePath) {
      continue;
    }
    Datadog.log('Custom build saw user-provided function', {
      event: 'custom_build_user_provided_function',
      custom_function_id: buildFunction.getFullId(),
      custom_function_module_path: buildFunction.customFunctionModulePath,
      custom_function_input_count: String(buildFunction.inputProviders?.length ?? 0),
      custom_function_output_count: String(buildFunction.outputProviders?.length ?? 0),
      ...(buildFunction.name ? { custom_function_name: buildFunction.name } : {}),
      ...(buildFunction.shell ? { custom_function_shell: buildFunction.shell } : {}),
      ...(buildFunction.supportedRuntimePlatforms
        ? {
            custom_function_supported_runtime_platforms:
              buildFunction.supportedRuntimePlatforms.join(','),
          }
        : {}),
    });
  }
}
