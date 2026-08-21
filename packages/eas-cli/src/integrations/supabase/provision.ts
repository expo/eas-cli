import openBrowserAsync from 'better-opn';
import chalk from 'chalk';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  formatSupabaseOrganization,
  getSupabaseProjectDashboardUrl,
} from '../../commandUtils/supabase';
import { isPermanentGraphqlError } from '../../graphql/client';
import { BackgroundJobReceiptDataFragment } from '../../graphql/generated';
import { SupabaseMutation } from '../../graphql/mutations/SupabaseMutation';
import { SupabaseQuery } from '../../graphql/queries/SupabaseQuery';
import {
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../../graphql/types/SupabaseConnection';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import { selectAsync } from '../../prompts';
import { sleepAsync } from '../../utils/promise';
import {
  BackgroundJobReceiptPollError,
  BackgroundJobReceiptPollErrorType,
  pollForBackgroundJobReceiptAsync,
} from '../../utils/pollForBackgroundJobReceiptAsync';

// The server holds the pending OAuth row for 15 minutes; match that so we don't time out on an
// approval the user completes within the window.
const CONNECTION_POLL_INTERVAL_MS = 2_000;
const CONNECTION_POLL_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_CONSECUTIVE_CONNECTION_ERRORS = 10;

// A freshly provisioned project takes a minute or two to become healthy; the publishable key only
// resolves once it is.
const READINESS_POLL_INTERVAL_MS = 3_000;
const READINESS_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
// A server fault is worth retrying, but not for the full timeout: once it repeats this many
// times it isn't a provisioning delay, and the user shouldn't wait five minutes to hear it.
const MAX_CONSECUTIVE_READINESS_ERRORS = 10;

// Background job create + publishable-key polling can take 5+ minutes; allow 7 min at 1s interval.
export const PROVISION_RECEIPT_MAX_CHECKS = 420;
export const PROVISION_RECEIPT_MAX_CONSECUTIVE_FETCH_ERRORS = 3;

export const SUPABASE_REGION_CHOICES = [
  { title: 'Americas (US)', value: 'americas' },
  { title: 'Europe / Middle East / Africa', value: 'emea' },
  { title: 'Asia Pacific', value: 'apac' },
];

export function projectNameSuffixForEnvironments(environments: string[]): string {
  return [...environments]
    .sort()
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 32);
}

export function toProvisionPollError(error: unknown, { hint }: { hint: string }): Error {
  if (!(error instanceof BackgroundJobReceiptPollError)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const trimmedHint = hint.trim();
  const join = (message: string): string =>
    trimmedHint ? `${message.trimEnd()}\n\n${trimmedHint}` : message;
  if (error.errorData.errorType === BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY) {
    return new Error(join(error.errorData.receiptErrorMessage ?? error.message));
  }
  if (
    error.errorData.errorType === BackgroundJobReceiptPollErrorType.TIMEOUT ||
    error.errorData.errorType === BackgroundJobReceiptPollErrorType.NULL_RECEIPT
  ) {
    return new Error(
      join('Timed out or lost contact while waiting for Supabase project provision.')
    );
  }
  return error;
}

/** Fast-forward guidance when additional (--environment) provision fails permanently. */
export function additionalProvisionFailureHint(environments: string[]): string {
  return [
    'Free a slot on your Supabase plan (delete, pause, or upgrade a project), then re-run:',
    `       eas integrations:supabase:connect --environment ${environments.join(',')}`,
    'Or set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY on those EAS environments to an existing Supabase project.',
  ].join('\n');
}

/** Where to find a project for --link (primary connect path). */
export function primaryProvisionFailureHint(): string {
  return [
    'If a project already exists in your Supabase dashboard, link it instead of provisioning:',
    '       eas integrations:supabase:connect --link <project-url>',
  ].join('\n');
}

export async function pollProvisionReceiptAsync(
  graphqlClient: ExpoGraphqlClient,
  receipt: BackgroundJobReceiptDataFragment,
  {
    startMessage,
    waitingMessage,
    failureMessage,
    failureHint,
  }: {
    startMessage: string;
    waitingMessage: string;
    failureMessage: string;
    failureHint: string;
  }
): Promise<BackgroundJobReceiptDataFragment> {
  const spinner = ora(startMessage).start();
  try {
    spinner.text = waitingMessage;
    const finalized = await pollForBackgroundJobReceiptAsync(graphqlClient, receipt, {
      maxChecks: PROVISION_RECEIPT_MAX_CHECKS,
      maxConsecutiveFetchErrors: PROVISION_RECEIPT_MAX_CONSECUTIVE_FETCH_ERRORS,
    });
    if (!finalized) {
      throw new Error('Supabase project provision finished without a receipt.');
    }
    // Stopped, not succeeded: the caller resolves what was provisioned and owns that message.
    spinner.stop();
    return finalized;
  } catch (error) {
    spinner.fail(failureMessage);
    throw toProvisionPollError(error, { hint: failureHint });
  }
}

export async function authorizeViaBrowserAsync(
  graphqlClient: ExpoGraphqlClient,
  account: { id: string; name: string },
  nonInteractive: boolean
): Promise<SupabaseConnectionData> {
  if (nonInteractive) {
    throw new Error(
      `Connecting Supabase requires approving access in a browser, which isn't possible in non-interactive mode. Re-run \`eas integrations:supabase:connect\` interactively.`
    );
  }

  const { url } = await SupabaseMutation.beginSupabaseOAuthAsync(graphqlClient, {
    accountId: account.id,
  });
  Log.addNewLineIfNone();
  Log.log(
    `Authorize Expo to access your Supabase account in the browser. You'll need an existing Supabase account.`
  );
  Log.log(`If your browser doesn't open automatically, authorize at this link: ${link(url)}`);
  void openBrowserAsync(url).catch(() => false);

  const spinner = ora(
    'Waiting for you to authorize in Supabase (up to 15 minutes; press Ctrl-C to cancel)'
  ).start();
  try {
    const connection = await pollForConnectionAsync(graphqlClient, account.id);
    const organizations = await loadOrganizationsBestEffortAsync(graphqlClient, account.id);
    spinner.succeed(
      `Connected Supabase organization ${chalk.bold(
        formatSupabaseOrganization(connection, organizations ?? undefined)
      )}`
    );
    return connection;
  } catch (error) {
    spinner.fail("Couldn't confirm the Supabase connection");
    throw error;
  }
}

export async function loadOrganizationsBestEffortAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string
): Promise<SupabaseOrganizationData[] | null> {
  try {
    return await SupabaseMutation.listSupabaseOrganizationsAsync(graphqlClient, accountId);
  } catch {
    return null;
  }
}

export async function pollForConnectionAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string
): Promise<SupabaseConnectionData> {
  const deadline = Date.now() + CONNECTION_POLL_TIMEOUT_MS;
  let consecutiveErrors = 0;
  for (;;) {
    let connection: SupabaseConnectionData | null = null;
    try {
      connection = await SupabaseQuery.getSupabaseConnectionByAccountIdAsync(
        graphqlClient,
        accountId,
        { useCache: false }
      );
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      Log.debug(`Polling for the Supabase connection failed: ${error}`);
      if (
        isPermanentGraphqlError(error) ||
        consecutiveErrors >= MAX_CONSECUTIVE_CONNECTION_ERRORS
      ) {
        Log.error(
          'Gave up checking whether the Supabase authorization finished. Fix the error below, then re-run `eas integrations:supabase:connect` — an authorization you already approved is still picked up.'
        );
        throw error;
      }
    }
    if (connection) {
      return connection;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'Timed out waiting for the Supabase connection. If you authorized it in your browser, re-run `eas integrations:supabase:connect` — it will pick up the connection.'
      );
    }
    await sleepAsync(CONNECTION_POLL_INTERVAL_MS);
  }
}

export async function resolvePublishableKeyAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  project: SupabaseProjectData
): Promise<string> {
  const spinner = ora('Waiting for the Supabase project to finish provisioning').start();
  const deadline = Date.now() + READINESS_POLL_TIMEOUT_MS;
  // The server returns a null key while the project is still provisioning, and throws for a real
  // problem. A rejected request can't succeed on a retry; a server fault might, but not forever.
  let consecutiveErrors = 0;
  for (;;) {
    let key: string | null = null;
    try {
      key = await SupabaseMutation.fetchSupabasePublishableKeyAsync(graphqlClient, appId);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      Log.debug(`Polling for the Supabase project readiness failed: ${error}`);
      if (isPermanentGraphqlError(error) || consecutiveErrors >= MAX_CONSECUTIVE_READINESS_ERRORS) {
        spinner.fail("Couldn't reach the Supabase project");
        Log.error(
          `The project may exist even though EAS can't read its key. Check it at ${getSupabaseProjectDashboardUrl(
            project
          )} before you re-run \`eas integrations:supabase:connect\`.`
        );
        throw error;
      }
    }
    if (key) {
      spinner.succeed('Supabase project is ready');
      return key;
    }
    if (Date.now() >= deadline) {
      spinner.fail('Supabase project did not finish provisioning in time');
      throw new Error(
        `The Supabase project is still provisioning. Once it's healthy (check ${getSupabaseProjectDashboardUrl(
          project
        )}), re-run \`eas integrations:supabase:connect\` to finish writing the environment variables.`
      );
    }
    await sleepAsync(READINESS_POLL_INTERVAL_MS);
  }
}

export async function resolveRegionAsync(
  flagValue: string | undefined,
  nonInteractive: boolean
): Promise<string> {
  if (flagValue !== undefined) {
    // The server accepts both the smart-group values (americas | emea | apac) and raw region
    // codes (e.g. us-east-1), so any non-empty value passes through.
    const region = flagValue.trim();
    if (!region) {
      throw new Error(
        'Pass a Supabase region to --region (americas, emea, apac, or a raw code like us-east-1).'
      );
    }
    return region;
  }
  if (nonInteractive) {
    throw new Error(
      'A Supabase region is required in non-interactive mode. Pass --region (americas, emea, or apac). The region is permanent once the project is created.'
    );
  }
  return await selectAsync(
    'Select a Supabase region (permanent once the project is created)',
    SUPABASE_REGION_CHOICES
  );
}

export async function resolveOrganizationAsync(
  graphqlClient: ExpoGraphqlClient,
  accountId: string,
  connection: SupabaseConnectionData,
  organizationFlag: string | undefined,
  nonInteractive: boolean,
  preloadedOrganizations: SupabaseOrganizationData[] | null
): Promise<SupabaseConnectionData> {
  if (organizationFlag) {
    if (organizationFlag === connection.supabaseOrganizationSlug) {
      return connection;
    }
    const organizations =
      preloadedOrganizations ??
      (await SupabaseMutation.listSupabaseOrganizationsAsync(graphqlClient, accountId));
    if (!organizations.some(organization => organization.slug === organizationFlag)) {
      throw new Error(
        `Supabase organization ${chalk.bold(
          organizationFlag
        )} isn't one of your connected organizations (${organizations
          .map(organization => organization.slug)
          .join(', ')}).`
      );
    }
    return await SupabaseMutation.setSupabaseConnectionOrganizationAsync(graphqlClient, {
      supabaseConnectionId: connection.id,
      organizationSlug: organizationFlag,
    });
  }
  if (nonInteractive) {
    return connection;
  }
  const organizations =
    preloadedOrganizations ??
    (await SupabaseMutation.listSupabaseOrganizationsAsync(graphqlClient, accountId));
  if (organizations.length <= 1) {
    return connection;
  }
  const chosen = await selectAsync(
    'Select the Supabase organization to use',
    organizations.map(organization => ({
      title: `${organization.name} (${organization.slug})`,
      value: organization.slug,
    }))
  );
  if (chosen === connection.supabaseOrganizationSlug) {
    return connection;
  }
  return await SupabaseMutation.setSupabaseConnectionOrganizationAsync(graphqlClient, {
    supabaseConnectionId: connection.id,
    organizationSlug: chosen,
  });
}
