import { Job, SshSettings, SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';

import { formatSecondsForLog } from './formatDuration';
import { sleepAsync } from './retry';
import { SshConnectionConfig, startUptermHostAsync } from './upterm';
import { BuildContext } from '../context';
import { Sentry } from '../sentry';

const MAX_SSH_REDIALS = 10;
const REDIAL_BACKOFF_MS = 6_000;
const CLIENT_COUNT_POLL_INTERVAL_MS = 5_000;
const MAX_SSH_IDLE_TIMEOUT_SECONDS = 3600;
const DEFAULT_SSH_IDLE_TIMEOUT_SECONDS = 0;

const CREATE_OR_UPDATE_TURTLE_SSH_SESSION_MUTATION = graphql(`
  mutation CreateOrUpdateTurtleSshSession(
    $target: TurtleSshTargetInput!
    $connectionConfig: TurtleSshConnectionConfigInput!
    $sessionSettings: TurtleSshSessionSettingsInput!
  ) {
    turtleSshSession {
      createOrUpdateTurtleSshSession(
        target: $target
        connectionConfig: $connectionConfig
        sessionSettings: $sessionSettings
      ) {
        id
        sessionSettings {
          idleTimeoutSeconds
        }
      }
    }
  }
`);

export type TurtleSshTarget = { type: 'BUILD' | 'JOB_RUN'; id: string };

export function isSshEnabled(job: Pick<Job, 'ssh'>): boolean {
  return job.ssh != null;
}

export function getSshIdleTimeoutSeconds(job: Pick<Job, 'ssh'>): number {
  const idleTimeoutSeconds = job.ssh?.idleTimeoutSeconds ?? DEFAULT_SSH_IDLE_TIMEOUT_SECONDS;
  if (
    !Number.isInteger(idleTimeoutSeconds) ||
    idleTimeoutSeconds < 0 ||
    idleTimeoutSeconds > MAX_SSH_IDLE_TIMEOUT_SECONDS
  ) {
    throw new SystemError(
      `SSH idle timeout must be an integer between 0 and ${MAX_SSH_IDLE_TIMEOUT_SECONDS} seconds, got ${idleTimeoutSeconds}.`,
      { trackingCode: 'SSH_IDLE_TIMEOUT_INVALID' }
    );
  }
  return idleTimeoutSeconds;
}

export function getSshRelayServerUrl(job: Pick<Job, 'ssh'>): string {
  const relayServerUrl = job.ssh?.relayServerUrl;
  if (!relayServerUrl) {
    throw new SystemError('SSH is enabled but no relay server URL was configured on the job.', {
      trackingCode: 'SSH_RELAY_SERVER_URL_MISSING',
    });
  }
  return relayServerUrl;
}

export type SshSessionHandle = {
  getConnectedClientCountAsync: () => Promise<number>;
  ensureConnectedAsync: () => Promise<void>;
  stopAsync: () => Promise<void>;
};

export type StartedSshSession = {
  handle: SshSessionHandle;
  idleTimeoutSeconds: number;
};

async function createOrUpdateSessionAsync(
  ctx: BuildContext,
  {
    target,
    connectionConfig,
    idleTimeoutSeconds,
  }: {
    target: TurtleSshTarget;
    connectionConfig: SshConnectionConfig & { reconnecting?: boolean };
    idleTimeoutSeconds: number;
  }
): Promise<{ idleTimeoutSeconds: number }> {
  const result = await ctx.graphqlClient
    .mutation(CREATE_OR_UPDATE_TURTLE_SSH_SESSION_MUTATION, {
      target,
      connectionConfig: {
        ...connectionConfig,
        type: 'UPTERM_V1',
      },
      sessionSettings: { idleTimeoutSeconds },
    })
    .toPromise();
  if (result.error || !result.data) {
    throw new SystemError(
      `Failed to create or update the SSH session: ${result.error?.message ?? 'no data returned'}`,
      { cause: result.error }
    );
  }
  const session = result.data.turtleSshSession.createOrUpdateTurtleSshSession;
  return { idleTimeoutSeconds: session.sessionSettings.idleTimeoutSeconds };
}

export async function startSshSessionAsync(
  ctx: BuildContext,
  {
    target,
    relayServerUrl,
    idleTimeoutSeconds: requestedIdleTimeoutSeconds,
  }: {
    target: TurtleSshTarget;
  } & SshSettings
): Promise<StartedSshSession> {
  const logger = ctx.logger;
  const host = await startUptermHostAsync(ctx, { relayServerUrl });
  let idleTimeoutSeconds: number;
  try {
    ({ idleTimeoutSeconds } = await createOrUpdateSessionAsync(ctx, {
      target,
      connectionConfig: { ...host.connectionConfig, reconnecting: false },
      idleTimeoutSeconds: requestedIdleTimeoutSeconds,
    }));
  } catch (err) {
    await host.stopAsync().catch(() => {});
    throw err;
  }

  const ensureConnectedAsync = async (): Promise<void> => {
    if (host.isAlive()) {
      return;
    }
    for (let attempt = 1; attempt <= MAX_SSH_REDIALS; attempt++) {
      try {
        if (!host.isAlive()) {
          logger.warn('The SSH relay connection dropped. Reconnecting...');
          await createOrUpdateSessionAsync(ctx, {
            target,
            connectionConfig: { ...host.connectionConfig, reconnecting: true },
            idleTimeoutSeconds: requestedIdleTimeoutSeconds,
          }).catch(() => {});
          await host.redialAsync();
        }
        await createOrUpdateSessionAsync(ctx, {
          target,
          connectionConfig: { ...host.connectionConfig, reconnecting: false },
          idleTimeoutSeconds: requestedIdleTimeoutSeconds,
        });
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
    },
    idleTimeoutSeconds,
  };
}

export async function superviseSshSessionAsync({
  handle,
  idleTimeoutSeconds,
  hasJobFinished,
  logger,
}: {
  handle: SshSessionHandle;
  idleTimeoutSeconds: number;
  hasJobFinished: () => boolean;
  logger: bunyan;
}): Promise<void> {
  const idleTimeoutMs = idleTimeoutSeconds * 1_000;
  let idleSince: number | null = null;
  let previousClientCount = 0;

  for (;;) {
    try {
      await handle.ensureConnectedAsync();
    } catch (err) {
      logger.warn({ err }, 'Could not restore the SSH relay connection. Closing the session.');
      Sentry.capture(
        'Could not restore the SSH relay connection',
        err instanceof Error ? err : undefined,
        {
          tags: { trackingCode: 'SSH_RELAY_RECONNECT_FAILED' },
        }
      );
      return;
    }

    let connectedClientCount: number;
    try {
      connectedClientCount = await handle.getConnectedClientCountAsync();
    } catch (err) {
      logger.warn({ err }, 'Could not read the SSH client count. Closing the session.');
      Sentry.capture(
        'Could not read the SSH client count',
        err instanceof Error ? err : undefined,
        {
          tags: { trackingCode: 'SSH_CLIENT_COUNT_UNREADABLE' },
        }
      );
      return;
    }
    if (connectedClientCount !== previousClientCount) {
      logger.info(`SSH clients connected: ${connectedClientCount}`);
      previousClientCount = connectedClientCount;
    }

    const jobHasFinished = hasJobFinished();
    if (connectedClientCount > 0 || !jobHasFinished) {
      idleSince = null;
    } else if (idleSince === null) {
      idleSince = Date.now();
    }

    if (jobHasFinished && connectedClientCount === 0) {
      if (idleTimeoutSeconds === 0) {
        logger.info('The job finished and no SSH client is connected. Closing the session.');
        return;
      }
      if (idleSince !== null && Date.now() - idleSince >= idleTimeoutMs) {
        logger.info(
          `No SSH client connected for ${formatSecondsForLog(idleTimeoutSeconds)} after the job finished. Closing the session.`
        );
        return;
      }
    }
    await sleepAsync(CLIENT_COUNT_POLL_INTERVAL_MS);
  }
}
