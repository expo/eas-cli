import openBrowserAsync from 'better-opn';
import chalk from 'chalk';

import Log, { link } from '../../log';
import { ora } from '../../ora';

// Points at a local or staging backend, like EXPO_LOCAL does for the Expo API.
const DEFAULT_DETOUR_API_BASE_URL = 'https://godetour.dev';
const DETOUR_API_BASE_URL = process.env.EXPO_DETOUR_API_URL ?? DEFAULT_DETOUR_API_BASE_URL;

export function nonDefaultApiBaseUrl(): string | null {
  return DETOUR_API_BASE_URL === DEFAULT_DETOUR_API_BASE_URL ? null : DETOUR_API_BASE_URL;
}

// Matches the server's TTL: timing out sooner would strand a valid approval.
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_POLL_BACKOFF_MS = 30_000;

export type DetourApp = {
  appId: string;
  name: string;
  /** Publishable key the SDK ships with. Not a secret. */
  apiKey: string | null;
  linkHost: string;
  dashboardUrl: string;
};

export type DetourSigningIdentity = {
  bundleId?: string;
  teamId?: string;
  packageName?: string;
  certificateFingerprints?: string[];
  /** Play App Signing fingerprint. Not in EAS — the user pastes it. */
  productionCertificate?: string;
  appStoreId?: string;
};

export class DetourApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function requestAsync<T>(
  path: string,
  {
    method = 'GET',
    deviceCode,
    body,
  }: { method?: string; deviceCode?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(new URL(path, DETOUR_API_BASE_URL), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(deviceCode ? { authorization: `Bearer ${deviceCode}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // The poll only checks its deadline between requests.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    let message = `Detour request failed (${response.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      Log.debug(text);
    }
    throw new DetourApiError(message, response.status);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

type StartedAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalMs?: number;
};

type PollResult = {
  status: 'pending' | 'approved' | 'denied' | 'expired';
  organizationId?: string;
};

/**
 * OAuth 2.0 device authorization grant (RFC 8628). The device code is this
 * process's credential; the user code grants nothing and is only compared.
 */
export async function authorizeAsync({
  emailHint,
  deviceLabel,
  nonInteractive,
}: {
  emailHint?: string;
  deviceLabel?: string;
  nonInteractive: boolean;
}): Promise<{ deviceCode: string; organizationId: string }> {
  if (nonInteractive) {
    throw new Error(
      'Connecting to Detour needs a browser approval. Re-run interactively, or pass --app-id and --api-key from the Detour dashboard.'
    );
  }

  const started = await requestAsync<StartedAuthorization>('/api/cli/authorization', {
    method: 'POST',
    body: { emailHint, deviceLabel },
  });

  Log.addNewLineIfNone();
  Log.log(`Your code: ${chalk.bold(started.userCode)}`);
  const opened = await openBrowserAsync(started.verificationUrl).catch(() => false);
  Log.log(
    opened
      ? `Opened ${link(started.verificationUrl)}`
      : `Open this URL to approve: ${link(started.verificationUrl)}`
  );

  const spinner = ora(
    `Waiting for approval in the browser — code ${started.userCode} (up to 30 minutes; press Ctrl-C to cancel)`
  ).start();
  const intervalMs = started.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;

  try {
    let backoffMs = intervalMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, backoffMs));

      let result: PollResult;
      try {
        result = await requestAsync<PollResult>('/api/cli/authorization/token', {
          method: 'POST',
          body: { deviceCode: started.deviceCode },
        });
        backoffMs = intervalMs;
      } catch (error) {
        // The user may already have approved, so a blip must not end the run.
        const status = error instanceof DetourApiError ? error.status : undefined;
        if (status !== undefined && status !== 429 && status < 500) {
          throw error;
        }
        Log.debug(error);
        backoffMs = Math.min(backoffMs * 2, MAX_POLL_BACKOFF_MS);
        continue;
      }

      if (result.status === 'approved' && result.organizationId) {
        spinner.succeed('Connected to Detour');
        return { deviceCode: started.deviceCode, organizationId: result.organizationId };
      }
      if (result.status === 'denied') {
        spinner.fail('The request was denied in the browser');
        throw new Error('Access was denied. Nothing was connected.');
      }
      if (result.status === 'expired') {
        spinner.fail('The approval link expired');
        throw new Error('The approval link expired. Re-run the command to get a new one.');
      }
    }
  } catch (error) {
    spinner.stop();
    throw error;
  }

  spinner.fail('Timed out waiting for approval');
  throw new Error('The approval link expired. Re-run the command to get a new one.');
}

export type DetourAppSummary = { appId: string; name: string };

export async function listAppsAsync(deviceCode: string): Promise<DetourAppSummary[]> {
  const { apps } = await requestAsync<{ apps: DetourAppSummary[] }>('/api/cli/apps', {
    deviceCode,
  });
  return apps ?? [];
}

export async function createAppAsync(deviceCode: string, appName: string): Promise<DetourApp> {
  const { app } = await requestAsync<{ app: DetourApp }>('/api/cli/apps', {
    method: 'POST',
    deviceCode,
    body: { appName },
  });
  return app;
}

/** Null on 404, which also covers an app in another organization. */
export async function findAppAsync(deviceCode: string, appId: string): Promise<DetourApp | null> {
  try {
    const { app } = await requestAsync<{ app: DetourApp }>(
      `/api/cli/apps/${encodeURIComponent(appId)}`,
      { deviceCode }
    );
    return app;
  } catch (error) {
    if (error instanceof DetourApiError && error.status === 404) {
      Log.debug(error.message);
      return null;
    }
    throw error;
  }
}

/** Tolerates a pasted "SHA-256:" label and whitespace; requires 32 bytes. */
export function parseFingerprint(value: string): string | null {
  // Matched first: stripping non-hex would pull letters out of the label.
  const colonSeparated = value.match(/[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){31}/);
  if (colonSeparated) {
    return colonSeparated[0].toUpperCase();
  }

  const hex = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 64 ? (hex.match(/.{2}/g) ?? []).join(':') : null;
}

export type DetourMissingField =
  | 'teamId'
  | 'appStoreId'
  | 'productionCertificate'
  | 'certificateFingerprints';

export async function updateSigningIdentityAsync(
  deviceCode: string,
  appId: string,
  identity: DetourSigningIdentity
): Promise<{ missing: DetourMissingField[]; publishFailed: boolean }> {
  const response = await requestAsync<{
    missing?: DetourMissingField[];
    publishFailed?: boolean;
  } | null>(`/api/cli/apps/${encodeURIComponent(appId)}/signing-identity`, {
    method: 'PATCH',
    deviceCode,
    body: identity,
  });
  return { missing: response?.missing ?? [], publishFailed: response?.publishFailed === true };
}

export const MISSING_FIELD_PROMPTS: Record<
  Exclude<DetourMissingField, 'certificateFingerprints'>,
  { message: string; hint: string; parse: (value: string) => string | null }
> = {
  teamId: {
    message: 'Apple Team ID',
    hint: 'Apple Developer → Membership details',
    parse: value => (/^[A-Za-z0-9]{10}$/.test(value.trim()) ? value.trim().toUpperCase() : null),
  },
  appStoreId: {
    message: 'App Store ID',
    hint: 'App Store Connect → your app → App Information, under Apple ID',
    parse: value => (/^\d+$/.test(value.trim()) ? value.trim() : null),
  },
  productionCertificate: {
    message: 'Play App Signing certificate (SHA-256)',
    hint: 'Play Console → Test and release → Setup → App integrity → App signing',
    parse: parseFingerprint,
  },
};

export function describeMissingFields(missing: DetourMissingField[]): string[] {
  // Plain URLs, not link(): these strings are also printed under --json.
  const advice: Record<DetourMissingField, string> = {
    teamId:
      'Team ID is not set. EAS could not tell which Apple team signs this app — re-run with --team-id, or Universal Links will not verify. Membership details: https://developer.apple.com/account',
    appStoreId:
      'App Store ID is not set. Pin it as ascAppId in your submit profile (https://docs.expo.dev/submit/eas-json/) or re-run with --app-store-id, or links cannot fall back to the App Store.',
    productionCertificate:
      'Play App Signing certificate is not set. Copy the SHA-256 from Play Console → App integrity (https://play.google.com/console) and re-run with --play-signing-cert, or App Links will not verify for store installs.',
    certificateFingerprints:
      'No Android signing certificate is set. Generate a keystore with eas credentials -p android, then re-run. https://docs.expo.dev/app-signing/managed-credentials/',
  };
  return missing.map(field => advice[field]);
}

/** The root domain resolves the organization, so no authorization is needed. */
export function getAppRedirectUrl(appId: string): string {
  return new URL(`/applications/${encodeURIComponent(appId)}`, DETOUR_API_BASE_URL).toString();
}
