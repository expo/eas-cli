import { Job, SshSettings, SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';

import { formatSecondsForLog } from './formatDuration';
import { sleepAsync } from './retry';
import { SshConnectionConfig, UptermSessionStatus, startUptermHostAsync } from './upterm';
import { BuildContext } from '../context';
import { Sentry } from '../sentry';

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
  readStatusAsync: () => Promise<UptermSessionStatus>;
  reportReconnectingAsync: (reconnecting: boolean) => Promise<void>;
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
      connectionConfig: { ...host.connectionConfig, reconnecting: host.startedReconnecting },
      idleTimeoutSeconds: requestedIdleTimeoutSeconds,
    }));
  } catch (err) {
    await host.stopAsync().catch(() => {});
    throw err;
  }

  let reportedReconnecting = host.startedReconnecting;
  const reportReconnectingAsync = async (reconnecting: boolean): Promise<void> => {
    if (reconnecting === reportedReconnecting) {
      return;
    }
    try {
      await createOrUpdateSessionAsync(ctx, {
        target,
        connectionConfig: { ...host.connectionConfig, reconnecting },
        idleTimeoutSeconds: requestedIdleTimeoutSeconds,
      });
      reportedReconnecting = reconnecting;
    } catch (err) {
      logger.debug({ err }, 'Failed to report the SSH relay connection state.');
    }
  };

  return {
    handle: {
      readStatusAsync: () => host.readStatusAsync(),
      reportReconnectingAsync,
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
  let previousReconnecting = false;

  for (;;) {
    let status: UptermSessionStatus;
    try {
      status = await handle.readStatusAsync();
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
    if (status.state === 'gone') {
      logger.warn(
        `Could not restore the SSH relay connection (${status.reason}). Closing the session.`
      );
      Sentry.capture(`Could not restore the SSH relay connection (${status.reason})`, {
        tags: { trackingCode: 'SSH_RELAY_RECONNECT_FAILED' },
      });
      return;
    }

    const reconnecting = status.state === 'reconnecting';
    if (reconnecting !== previousReconnecting) {
      if (reconnecting) {
        logger.warn('The SSH relay connection dropped. Reconnecting...');
      } else {
        logger.info('The SSH relay connection was restored.');
      }
      previousReconnecting = reconnecting;
    }
    await handle.reportReconnectingAsync(reconnecting);

    const { connectedClientCount } = status;
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
