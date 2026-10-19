import { Platform } from '@expo/eas-build-job';

import { getAgentTelemetryContext } from '../analytics/agent';
import { LazyExperimentationClient } from '../experimentation/LazyExperimentationClient';
import { requestedPlatformDisplayNames } from '../platform';

export const FREE_TIER_LIMIT_AGENT_GUIDANCE_EXPERIMENT_NAMESPACE =
  'cli-build-free-tier-limit-agent-guidance';

export type FreeTierLimitAgentGuidanceVariant = 'control' | 'treatment';

export type FreeTierLimitAgentGuidanceExperiment = {
  experimentation: LazyExperimentationClient;
  accountId: string;
};

export function getFreeTierLimitAgentGuidanceExperiment(ctx: {
  experimentation?: LazyExperimentationClient;
  accountId: string;
}): FreeTierLimitAgentGuidanceExperiment | undefined {
  return ctx.experimentation
    ? { experimentation: ctx.experimentation, accountId: ctx.accountId }
    : undefined;
}

/**
 * Resolves the account's variant. Only runs driven by a coding agent are eligible. Other runs get
 * control before the client loads, so they make no config request and log no exposure.
 */
export async function resolveFreeTierLimitAgentGuidanceVariantAsync({
  experimentation,
  accountId,
}: FreeTierLimitAgentGuidanceExperiment): Promise<FreeTierLimitAgentGuidanceVariant> {
  if (!getAgentTelemetryContext()) {
    return 'control';
  }
  const client = await experimentation.getClientAsync();
  return client
    .getAccountNamespace(FREE_TIER_LIMIT_AGENT_GUIDANCE_EXPERIMENT_NAMESPACE, { accountId })
    .getParam<FreeTierLimitAgentGuidanceVariant>('variant', 'control');
}

export function formatFreeTierLimitAgentGuidance(platform: Platform): string {
  const platformName = requestedPlatformDisplayNames[platform];
  return `Fix: Human required: ${platformName} builds for this account are blocked until the Free plan resets. Upgrading costs money, so an account owner or admin decides.`;
}

export async function maybeAppendFreeTierLimitAgentGuidanceAsync(
  message: string,
  platform: Platform,
  experiment: FreeTierLimitAgentGuidanceExperiment | undefined
): Promise<string> {
  if (
    !experiment ||
    (await resolveFreeTierLimitAgentGuidanceVariantAsync(experiment)) !== 'treatment'
  ) {
    return message;
  }
  return `${message}\n${formatFreeTierLimitAgentGuidance(platform)}`;
}
