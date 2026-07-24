import { Env, SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';

import { sleepAsync } from './retry';
import { DEFAULT_SSH_RELAY_SERVER_URL, SshConnectionConfig, startUptermHostAsync } from './upterm';
import { BuildContext } from '../context';

const MAX_SSH_REDIALS = 5;
const REDIAL_BACKOFF_MS = 2_000;
const CLIENT_COUNT_POLL_INTERVAL_MS = 5_000;

const CREATE_TURTLE_SSH_SESSION_MUTATION = graphql(`
  mutation CreateTurtleSshSession($workflowJobId: ID!, $connectionConfig: JSONObject!) {
    turtleSshSession {
      createTurtleSshSession(workflowJobId: $workflowJobId, connectionConfig: $connectionConfig) {
        id
        idleTimeoutSeconds
      }
    }
  }
`);

const UPDATE_TURTLE_SSH_SESSION_CONNECTION_CONFIG_MUTATION = graphql(`
  mutation UpdateTurtleSshSessionConnectionConfig(
    $turtleSshSessionId: ID!
    $connectionConfig: JSONObject!
  ) {
    turtleSshSession {
      updateTurtleSshSessionConnectionConfig(
        turtleSshSessionId: $turtleSshSessionId
        connectionConfig: $connectionConfig
      ) {
        id
      }
    }
  }
`);

const CLOSE_TURTLE_SSH_SESSION_MUTATION = graphql(`
  mutation CloseTurtleSshSession($turtleSshSessionId: ID!) {
    turtleSshSession {
      closeTurtleSshSession(turtleSshSessionId: $turtleSshSessionId) {
        id
      }
    }
  }
`);

export function isWorkflowSshEnabled(env: Env): boolean {
  return env.EAS_WORKFLOW_SSH_ENABLED === 'true';
}

export function getWorkflowJobIdOrThrow(env: Env): string {
  const workflowJobId = env.__WORKFLOW_JOB_ID;
  if (!workflowJobId) {
    throw new SystemError(
      '__WORKFLOW_JOB_ID is not set. It should be present in the job environment when ssh is enabled.'
    );
  }
  return workflowJobId;
}

export function getSshRelayServerUrl(env: Env): string {
  return env.EAS_SSH_RELAY_URL ?? DEFAULT_SSH_RELAY_SERVER_URL;
}

export type SshSessionHandle = {
  getConnectedClientCountAsync: () => Promise<number | null>;
  ensureConnectedAsync: () => Promise<void>;
  stopAsync: () => Promise<void>;
  closeSessionAsync: () => Promise<void>;
};

export type StartedSshSession = {
  handle: SshSessionHandle;
  idleTimeoutSeconds: number;
};

/** Human-readable idle timeout for worker logs (e.g. 300 → "5 minutes", 90 → "1 minute 30 seconds"). */
export function formatSshIdleTimeoutForLog(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  }
  if (minutes > 0) {
    parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(seconds === 1 ? '1 second' : `${seconds} seconds`);
  }
  return parts.join(' ');
}

async function createSessionAsync(
  ctx: BuildContext,
  {
    workflowJobId,
    connectionConfig,
  }: { workflowJobId: string; connectionConfig: SshConnectionConfig }
): Promise<{ turtleSshSessionId: string; idleTimeoutSeconds: number }> {
  const result = await ctx.graphqlClient
    .mutation(CREATE_TURTLE_SSH_SESSION_MUTATION, {
      workflowJobId,
      connectionConfig,
    })
    .toPromise();
  if (result.error || !result.data) {
    throw new SystemError(
      `Failed to create the SSH session: ${result.error?.message ?? 'no data returned'}`
    );
  }
  const session = result.data.turtleSshSession.createTurtleSshSession;
  return { turtleSshSessionId: session.id, idleTimeoutSeconds: session.idleTimeoutSeconds };
}

async function reportConnectionConfigAsync(
  ctx: BuildContext,
  {
    turtleSshSessionId,
    connectionConfig,
  }: { turtleSshSessionId: string; connectionConfig: SshConnectionConfig }
): Promise<void> {
  const result = await ctx.graphqlClient
    .mutation(UPDATE_TURTLE_SSH_SESSION_CONNECTION_CONFIG_MUTATION, {
      turtleSshSessionId,
      connectionConfig,
    })
    .toPromise();
  if (result.error) {
    throw new SystemError(`Failed to update the SSH connection config: ${result.error.message}`);
  }
}

async function closeSessionAsync(
  ctx: BuildContext,
  logger: bunyan,
  { turtleSshSessionId }: { turtleSshSessionId: string }
): Promise<void> {
  logger.info('Closing the SSH session.');
  const result = await ctx.graphqlClient
    .mutation(CLOSE_TURTLE_SSH_SESSION_MUTATION, { turtleSshSessionId })
    .toPromise();
  if (result.error) {
    throw new SystemError(`Failed to close the SSH session: ${result.error.message}`);
  }
}

export async function startSshSessionAsync(
  ctx: BuildContext,
  { workflowJobId, relayServerUrl }: { workflowJobId: string; relayServerUrl: string }
): Promise<StartedSshSession> {
  // Capture the phase-scoped logger now. After SSH_SESSION returns with doNotMarkEnd, ctx.logger
  // is reset to the default logger; reconnect/close logs must still carry phase: SSH_SESSION.
  const logger = ctx.logger;
  const host = await startUptermHostAsync(ctx, { relayServerUrl });
  let turtleSshSessionId: string;
  let idleTimeoutSeconds: number;
  try {
    ({ turtleSshSessionId, idleTimeoutSeconds } = await createSessionAsync(ctx, {
      workflowJobId,
      connectionConfig: host.connectionConfig,
    }));
  } catch (err) {
    // The upterm host is already dialed and detached; tear it down so a create failure does not leak
    // an orphaned tunnel on the relay.
    await host.stopAsync().catch(() => {});
    throw err;
  }

  const ensureConnectedAsync = async (): Promise<void> => {
    if (host.isAlive()) {
      return;
    }
    let connectionConfig: SshConnectionConfig | undefined;
    for (let attempt = 1; attempt <= MAX_SSH_REDIALS; attempt++) {
      try {
        // Redial only while the tunnel is actually down. If a redial succeeded but reporting its
        // config failed (a flaky mutation), retry the report with the same config rather than
        // rotating the secret and burning another reconnect attempt.
        if (!host.isAlive() || !connectionConfig) {
          logger.warn('The SSH relay connection dropped. Reconnecting...');
          connectionConfig = await host.redialAsync();
        }
        await reportConnectionConfigAsync(ctx, { turtleSshSessionId, connectionConfig });
        logger.info('The SSH relay connection was restored.');
        return;
      } catch (err) {
        logger.warn({ err }, `SSH reconnect attempt ${attempt} of ${MAX_SSH_REDIALS} failed.`);
        if (attempt < MAX_SSH_REDIALS) {
          await sleepAsync(REDIAL_BACKOFF_MS);
        }
      }
    }
    throw new SystemError(
      `The SSH relay connection dropped and could not be restored after ${MAX_SSH_REDIALS} attempts.`
    );
  };

  return {
    handle: {
      getConnectedClientCountAsync: () => host.getConnectedClientCountAsync(),
      ensureConnectedAsync,
      stopAsync: () => host.stopAsync(),
      closeSessionAsync: () => closeSessionAsync(ctx, logger, { turtleSshSessionId }),
    },
    idleTimeoutSeconds,
  };
}

export async function holdSshSessionUntilIdleAsync({
  getConnectedClientCount,
  ensureConnected,
  idleTimeoutSeconds,
  logger,
}: {
  getConnectedClientCount: () => Promise<number | null>;
  ensureConnected: () => Promise<void>;
  idleTimeoutSeconds: number;
  logger: bunyan;
}): Promise<void> {
  const idleTimeoutMs = idleTimeoutSeconds * 1_000;
  let lastActiveAt = Date.now();
  let previousClientCount = 0;

  for (;;) {
    try {
      await ensureConnected();
    } catch (err) {
      logger.warn({ err }, 'Could not restore the SSH relay connection. Closing the session.');
      return;
    }
    const connectedClientCount = await getConnectedClientCount();
    if (connectedClientCount !== null) {
      if (connectedClientCount > previousClientCount) {
        logger.info(
          connectedClientCount === 1
            ? 'An SSH client connected.'
            : `An SSH client connected (${connectedClientCount} connected).`
        );
      } else if (connectedClientCount < previousClientCount) {
        logger.info(
          connectedClientCount === 0
            ? 'The SSH client disconnected.'
            : `An SSH client disconnected (${connectedClientCount} still connected).`
        );
      }
      if (connectedClientCount > 0) {
        lastActiveAt = Date.now();
      }
      previousClientCount = connectedClientCount;
    }
    const isClientConnected = connectedClientCount !== null && connectedClientCount > 0;
    if (!isClientConnected && Date.now() - lastActiveAt >= idleTimeoutMs) {
      logger.info(
        `No SSH client connected for ${formatSshIdleTimeoutForLog(idleTimeoutSeconds)}. Closing the session.`
      );
      return;
    }
    await sleepAsync(CLIENT_COUNT_POLL_INTERVAL_MS);
  }
}
