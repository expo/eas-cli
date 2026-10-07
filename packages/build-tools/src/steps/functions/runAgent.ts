import { SystemError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import { z } from 'zod';

import { CustomBuildContext } from '../../customBuildContext';
import { AGENT_KINDS, runAgentAsync } from '../utils/agentRun';

export function createRunAgentBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'run_agent',
    name: 'Run agent',
    __metricsId: 'eas/run_agent',
    supportedRuntimePlatforms: [BuildRuntimePlatform.LINUX],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'agent_kind',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'agent_run_id',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'max_duration_seconds',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      BuildStepInput.createProvider({
        id: 'prompt',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs, env, signal }) => {
      const inputErrors = {
        agentKind: `The "agent_kind" input must be one of ${AGENT_KINDS.join(', ')}, but received "${String(inputs.agent_kind.value)}".`,
        agentRunId: `The "agent_run_id" input must be the UUID of an agent run, but received "${String(inputs.agent_run_id.value)}".`,
        maxDurationSeconds: `The "max_duration_seconds" input must be a positive whole number of seconds, but received "${String(inputs.max_duration_seconds.value)}".`,
        prompt: 'The "prompt" input must be a non-empty string.',
      };
      const parsedInputs = z
        .object({
          agent_kind: z.enum(AGENT_KINDS, { error: inputErrors.agentKind }),
          agent_run_id: z.uuid({ error: inputErrors.agentRunId }),
          max_duration_seconds: z
            .number({ error: inputErrors.maxDurationSeconds })
            .int({ error: inputErrors.maxDurationSeconds })
            .positive({ error: inputErrors.maxDurationSeconds }),
          prompt: z.string({ error: inputErrors.prompt }).min(1, { error: inputErrors.prompt }),
        })
        .safeParse({
          agent_kind: inputs.agent_kind.value,
          agent_run_id: inputs.agent_run_id.value,
          max_duration_seconds: inputs.max_duration_seconds.value,
          prompt: inputs.prompt.value,
        });
      if (!parsedInputs.success) {
        throw createValidationError(parsedInputs.error);
      }
      const {
        agent_kind: agentKind,
        agent_run_id: agentRunId,
        max_duration_seconds: maxDurationSeconds,
        prompt,
      } = parsedInputs.data;
      const parsedEnv = z
        .object({
          EXPO_TOKEN: z
            .string({ error: 'EXPO_TOKEN is required to run an agent.' })
            .min(1, { error: 'EXPO_TOKEN is required to run an agent.' }),
          PATH: z
            .string({ error: 'PATH is required to run an agent.' })
            .min(1, { error: 'PATH is required to run an agent.' }),
          EAS_BUILD_NPM_CACHE_URL: z.string().optional(),
        })
        .safeParse(env);
      if (!parsedEnv.success) {
        throw createValidationError(parsedEnv.error);
      }
      const {
        EXPO_TOKEN: expoToken,
        PATH: pathEnv,
        EAS_BUILD_NPM_CACHE_URL: npmRegistryUrl,
      } = parsedEnv.data;
      if (!ctx.expoApiV2BaseUrl) {
        throw new SystemError('Expo API URL is required to run an agent.');
      }
      if (!ctx.mcpServerUrl) {
        throw new SystemError('MCP server URL is required to run an agent.');
      }
      // The worker config holds the MCP server's WebSocket URL; its HTTP endpoint is on the same host.
      const mcpUrl = new URL('/mcp', ctx.mcpServerUrl);
      mcpUrl.protocol = mcpUrl.protocol.replace(/^ws/, 'http');

      await runAgentAsync({
        agentKind,
        agentRunId,
        maxDurationSeconds,
        prompt,
        expoToken,
        expoApiV2BaseUrl: ctx.expoApiV2BaseUrl,
        mcpUrl: mcpUrl.toString(),
        pathEnv,
        npmRegistryUrl,
        logger: stepCtx.logger,
        signal,
      });
    },
  });
}

function createValidationError(error: z.ZodError): SystemError {
  return new SystemError(error.issues.map(issue => issue.message).join(' '));
}
