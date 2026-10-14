import chalk from 'chalk';

import { getAccountBillingUrl } from './utils/url';
import { Analytics, AnalyticsEventProperties, BuildEvent } from '../analytics/AnalyticsManager';
import { formatStarterSubscribeCommand, hasPaidSubscription } from '../billing/plans';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { ExperimentationClient } from '../experimentation/ExperimentationClient';
import { AccountQuery } from '../graphql/queries/AccountQuery';
import Log, { link } from '../log';

/** Must match the namespace in the server's account experimentation config. */
export const CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE = 'cli-build-concurrency-limit';

type ConcurrencyLimitVariant = 'control' | 'treatment';

/** Spinner text for the treatment arm. The details are in the persisted line above the spinner. */
export const TREATMENT_SPINNER_TEXT = 'Waiting for a concurrency to become available…';

export type ConcurrencyLimitMessageOptions = {
  graphqlClient: ExpoGraphqlClient;
  experimentation: ExperimentationClient;
  analytics: Analytics;
  accountId: string;
  accountName: string;
  buildIds: string[];
  nonInteractive: boolean;
  /** Properties of the `build cli build command` event, so the two events share a `tracking_id`. */
  analyticsEventProperties: AnalyticsEventProperties;
};

/**
 * Prints the concurrency-limit experiment message at most once per `eas build` run.
 *
 * Call `maybeShowAsync` only once a build has waited in NEW for the grace period, because the first
 * call reads the variant and logs the exposure. Control accounts get no network call and no output.
 * Treatment accounts get one account query, one persisted line, and one analytics event.
 */
export class ConcurrencyLimitMessage {
  private pending: Promise<boolean> | null = null;

  constructor(private readonly options: ConcurrencyLimitMessageOptions) {}

  /** Builds the message for a run, or nothing when the command has no experimentation client. */
  public static forBuildRun({
    experimentation,
    startedBuilds,
    buildCtx,
    ...options
  }: Omit<
    ConcurrencyLimitMessageOptions,
    'experimentation' | 'buildIds' | 'accountId' | 'accountName' | 'analyticsEventProperties'
  > & {
    experimentation: ExperimentationClient | undefined;
    startedBuilds: { build: { id: string } }[];
    buildCtx: Pick<
      ConcurrencyLimitMessageOptions,
      'accountId' | 'accountName' | 'analyticsEventProperties'
    >;
  }): ConcurrencyLimitMessage | undefined {
    if (!experimentation) {
      return undefined;
    }
    return new ConcurrencyLimitMessage({
      ...options,
      experimentation,
      buildIds: startedBuilds.map(({ build }) => build.id),
      accountId: buildCtx.accountId,
      accountName: buildCtx.accountName,
      analyticsEventProperties: buildCtx.analyticsEventProperties,
    });
  }

  /** Never throws. Resolves to true when the treatment line was printed. */
  public async maybeShowAsync(): Promise<boolean> {
    this.pending ??= this.showOnceAsync();
    return await this.pending;
  }

  private async showOnceAsync(): Promise<boolean> {
    const { graphqlClient, experimentation, analytics, accountId, accountName } = this.options;
    try {
      const variant = experimentation
        .getAccountNamespace(CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE, { accountId })
        .getParam<ConcurrencyLimitVariant>('variant', 'control');
      if (variant !== 'treatment') {
        return false;
      }

      const usage = await AccountQuery.getConcurrencyUsageAsync(graphqlClient, accountId);
      const subscription = usage.subscription ?? null;
      const activeBuildCount = usage.concurrencyConsumers.filter(
        consumer => consumer.__typename === 'Build'
      ).length;
      const activeJobRunCount = usage.concurrencyConsumers.length - activeBuildCount;
      const concurrencyLimit = subscription?.concurrencies?.total ?? null;
      const hasPaidPlan = hasPaidSubscription(subscription);
      const planName = subscription?.name ?? null;

      Log.newLine();
      Log.log(
        formatConcurrencyLimitMessage({
          accountName,
          planName,
          activeBuildCount,
          activeJobRunCount,
          concurrencyLimit,
          hasPaidPlan,
        })
      );
      Log.newLine();

      analytics.logEvent(BuildEvent.CONCURRENCY_LIMIT_MESSAGE_SHOWN, {
        ...this.options.analyticsEventProperties,
        experiment_name: CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE,
        variant,
        build_ids: this.options.buildIds.join(','),
        build_count: this.options.buildIds.length,
        active_consumer_count: activeBuildCount + activeJobRunCount,
        active_build_count: activeBuildCount,
        active_job_run_count: activeJobRunCount,
        concurrency_limit: concurrencyLimit ?? -1,
        has_paid_plan: hasPaidPlan,
        ...(subscription?.planId ? { plan_id: subscription.planId } : {}),
        ...(planName ? { plan_name: planName } : {}),
        non_interactive: this.options.nonInteractive,
      });
      return true;
    } catch (error) {
      Log.debug(
        '[concurrency-limit] Failed to show the concurrency limit message. Keeping the default text.',
        error
      );
      return false;
    }
  }
}

export function formatConcurrencyLimitMessage({
  accountName,
  planName,
  activeBuildCount,
  activeJobRunCount,
  concurrencyLimit,
  hasPaidPlan,
}: {
  accountName: string;
  planName: string | null;
  activeBuildCount: number;
  activeJobRunCount: number;
  concurrencyLimit: number | null;
  hasPaidPlan: boolean;
}): string {
  // The counts only explain the wait when they confirm it. A per-platform pool can be full while
  // the totals still show a free slot, so fall back to a count-free sentence in that case.
  const activeCount = activeBuildCount + activeJobRunCount;
  const countsConfirmLimit = concurrencyLimit !== null && activeCount >= concurrencyLimit;
  const reason = countsConfirmLimit
    ? `${formatActiveConsumers(activeBuildCount, activeJobRunCount)} already running and the ${
        planName ?? 'current'
      } plan includes ${concurrencyLimit}.`
    : 'All concurrencies in your plan are in use.';
  const billingLink = link(getTreatmentBillingUrl(accountName), { dim: false });

  const lines = [`Your build is waiting for a free concurrency. ${reason}`];
  if (hasPaidPlan) {
    lines.push(
      `Add concurrencies ($50/mo each) so your team can build at the same time: ${billingLink}`
    );
  } else {
    lines.push(`Upgrade to Starter or Production to build more at once: ${billingLink}`);
    lines.push(`Or run ${chalk.bold(formatStarterSubscribeCommand(accountName))}`);
  }
  return lines.join('\n');
}

/**
 * The billing URL with source tags, so the website can attribute a visit to this message.
 * Only the treatment arm uses it. The control arm keeps the plain billing URL.
 */
export function getTreatmentBillingUrl(accountName: string): string {
  const url = new URL(getAccountBillingUrl(accountName));
  url.searchParams.set('utm_source', 'eas-cli');
  url.searchParams.set('utm_campaign', CONCURRENCY_LIMIT_EXPERIMENT_NAMESPACE);
  return url.toString();
}

/** "2 builds are", "1 workflow job is", or "1 build and 2 workflow jobs are". */
function formatActiveConsumers(buildCount: number, jobRunCount: number): string {
  const parts: string[] = [];
  if (buildCount > 0) {
    parts.push(`${buildCount} ${buildCount === 1 ? 'build' : 'builds'}`);
  }
  if (jobRunCount > 0) {
    parts.push(`${jobRunCount} ${jobRunCount === 1 ? 'workflow job' : 'workflow jobs'}`);
  }
  const verb = buildCount + jobRunCount === 1 ? 'is' : 'are';
  return `${parts.join(' and ')} ${verb}`;
}
