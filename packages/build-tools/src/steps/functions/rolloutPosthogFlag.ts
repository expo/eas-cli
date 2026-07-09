import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { z } from 'zod';

import { MISSING_POSTHOG_API_TARGET_MESSAGE, PosthogClient } from '../utils/PosthogClient';
import { PosthogUtils } from '../utils/PosthogUtils';

const SEARCH_LIMIT = 200;

const FeatureFlagGroupSchema = z.object({ properties: z.unknown().optional() }).passthrough();
const FeatureFlagSchema = z
  .object({
    id: z.number(),
    key: z.string(),
    filters: z
      .object({
        groups: z.array(FeatureFlagGroupSchema).optional(),
        payloads: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const FlagSearchResponseSchema = z.object({ results: z.array(z.unknown()) });

type FeatureFlagGroup = z.infer<typeof FeatureFlagGroupSchema>;
type FeatureFlagFilters = NonNullable<z.infer<typeof FeatureFlagSchema>['filters']>;

function isCatchAllGroup(group: FeatureFlagGroup): boolean {
  const { properties } = group;
  return (
    properties === undefined ||
    properties === null ||
    (Array.isArray(properties) && properties.length === 0)
  );
}

export function createRolloutPosthogFlagFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'posthog_flag_rollout',
    name: 'Roll out a PostHog feature flag',
    __metricsId: 'eas/posthog_flag_rollout',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'flag',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: true,
      }),
      BuildStepInput.createProvider({
        id: 'active',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'rollout_percentage',
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'payload',
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'variant',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'api_key',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'project_id',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
      BuildStepInput.createProvider({
        id: 'ignore_error',
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: false,
      }),
    ],
    fn: async (stepCtx, { inputs, env }) => {
      const { logger } = stepCtx;
      const ignoreError = Boolean(inputs.ignore_error.value);

      const flagKey = inputs.flag.value as string;
      const active = inputs.active.value as boolean | undefined;
      const rolloutPercentage = inputs.rollout_percentage.value as number | undefined;
      const payload = inputs.payload.value as Record<string, unknown> | undefined;
      const variant = inputs.variant.value as string | undefined;
      if (active === undefined && rolloutPercentage === undefined && payload === undefined) {
        throw new UserError(
          'EAS_POSTHOG_FLAG_NO_CHANGE',
          'You need to provide "active", "rollout_percentage", or "payload" to change the feature flag.'
        );
      }
      if (
        rolloutPercentage !== undefined &&
        (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100)
      ) {
        throw new UserError(
          'EAS_POSTHOG_FLAG_INVALID_ROLLOUT',
          `"rollout_percentage" must be an integer between 0 and 100, got ${rolloutPercentage}.`
        );
      }

      const client = PosthogClient.fromEnv({
        apiKeyOverride: inputs.api_key.value as string | undefined,
        projectIdOverride: inputs.project_id.value as string | undefined,
        env,
      });
      if (!client) {
        PosthogUtils.failOrLogError({
          logger,
          ignoreError,
          error: new UserError(
            'EAS_POSTHOG_MISSING_CREDENTIALS',
            MISSING_POSTHOG_API_TARGET_MESSAGE
          ),
        });
        return;
      }

      await rolloutPosthogFlagAsync({
        logger,
        client,
        flagKey,
        active,
        rolloutPercentage,
        payload,
        variant,
        ignoreError,
      });
    },
  });
}

async function rolloutPosthogFlagAsync({
  logger,
  client,
  flagKey,
  active,
  rolloutPercentage,
  payload,
  variant,
  ignoreError,
}: {
  logger: bunyan;
  client: PosthogClient;
  flagKey: string;
  active: boolean | undefined;
  rolloutPercentage: number | undefined;
  payload: Record<string, unknown> | undefined;
  variant: string | undefined;
  ignoreError: boolean;
}): Promise<void> {
  let searchResponse;
  try {
    searchResponse = await client.requestAsync(
      'GET',
      `/feature_flags/?limit=${SEARCH_LIMIT}&search=${encodeURIComponent(flagKey)}`,
      { action: `Looking up PostHog flag "${flagKey}"`, forbiddenScope: 'feature_flag:read' }
    );
  } catch (error) {
    PosthogUtils.failOrLogError({ logger, ignoreError, error });
    return;
  }

  let results: unknown[];
  try {
    results = FlagSearchResponseSchema.parse(await searchResponse.json()).results;
  } catch (error) {
    PosthogUtils.failOrLogError({
      logger,
      ignoreError,
      error: new UserError(
        'EAS_POSTHOG_FLAG_UNEXPECTED_RESPONSE',
        `PostHog flag lookup for "${flagKey}" returned an unexpected response.`,
        { cause: error }
      ),
    });
    return;
  }

  const flag = results
    .flatMap(result => {
      const parsed = FeatureFlagSchema.safeParse(result);
      return parsed.success ? [parsed.data] : [];
    })
    .find(candidate => candidate.key === flagKey);
  if (!flag) {
    PosthogUtils.failOrLogError({
      logger,
      ignoreError,
      error: new UserError(
        'EAS_POSTHOG_FLAG_NOT_FOUND',
        `No PostHog feature flag with key "${flagKey}" was found. Check the "flag" input.`
      ),
    });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (active !== undefined) {
    patch.active = active;
  }
  let filters = flag.filters;
  if (rolloutPercentage !== undefined) {
    filters = buildRolloutFilters({ logger, flagKey, filters, rolloutPercentage });
  }
  if (payload !== undefined) {
    filters = {
      ...filters,
      payloads: { ...filters?.payloads, [variant ?? 'true']: JSON.stringify(payload) },
    };
  }
  if (rolloutPercentage !== undefined || payload !== undefined) {
    patch.filters = filters;
  }

  try {
    await client.requestAsync('PATCH', `/feature_flags/${flag.id}/`, {
      action: `Updating PostHog flag "${flagKey}"`,
      forbiddenScope: 'feature_flag:write',
      body: patch,
    });
  } catch (error) {
    PosthogUtils.failOrLogError({ logger, ignoreError, error });
    return;
  }

  logger.info(`Updated PostHog feature flag "${flagKey}".`);
}

function buildRolloutFilters({
  logger,
  flagKey,
  filters,
  rolloutPercentage,
}: {
  logger: bunyan;
  flagKey: string;
  filters: FeatureFlagFilters | undefined;
  rolloutPercentage: number;
}): FeatureFlagFilters {
  const groups = filters?.groups ?? [];
  if (groups.length === 0) {
    return { ...filters, groups: [{ properties: [], rollout_percentage: rolloutPercentage }] };
  }

  const catchAllIndex = groups.findIndex(isCatchAllGroup);
  const hasCatchAll = catchAllIndex >= 0;
  const targetIndex = hasCatchAll ? catchAllIndex : 0;
  if (!hasCatchAll) {
    logger.warn(
      `Flag "${flagKey}" has no catch-all release-condition group; setting rollout_percentage on the first group, which is condition-scoped.`
    );
  } else if (groups.length > 1) {
    logger.warn(
      `Flag "${flagKey}" has ${groups.length} release-condition groups; setting rollout_percentage only on the catch-all group to preserve the others.`
    );
  }

  const groupsWithRollout = groups.map((group, index) =>
    index === targetIndex ? { ...group, rollout_percentage: rolloutPercentage } : group
  );
  return { ...filters, groups: groupsWithRollout };
}
