import { Env, SshSettings, SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { graphql } from 'gql.tada';

import { sleepAsync } from './retry';
import { SshConnectionConfig, startUptermHostAsync } from './upterm';
import { BuildContext } from '../context';

// ~60s of backoff across failed dials (9 × 6s), plus dial time itself.
const MAX_SSH_REDIALS = 10;
const REDIAL_BACKOFF_MS = 6_000;
const CLIENT_COUNT_POLL_INTERVAL_MS = 5_000;
/** Cap how long an unreadable client count can block teardown after the job finishes. */
const UNKNOWN_CLIENT_COUNT_GRACE_MS = 30_000;
const MAX_SSH_IDLE_TIMEOUT_SECONDS = 3600;

const CREATE_OR_UPDATE_TURTLE_SSH_SESSION_MUTATION = graphql(`
  mutation CreateOrUpdateTurtleSshSession(
    $turtleJobRunId: ID
    $turtleBuildId: ID
    $connectionConfig: TurtleSshConnectionConfigInput!
    $sessionSettings: TurtleSshSessionSettingsInput!
  ) {
    turtleSshSession {
      createOrUpdateTurtleSshSession(
        turtleJobRunId: $turtleJobRunId
        turtleBuildId: $turtleBuildId
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

export type TurtleSshTarget =
  | { turtleJobRunId: string; turtleBuildId?: never }
  | { turtleJobRunId?: never; turtleBuildId: string };

export type JobWithOptionalSsh = { ssh?: SshSettings };

export function isWorkflowSshEnabled(job: JobWithOptionalSsh): boolean {
  return job.ssh != null;
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

export function getSshIdleTimeoutSeconds(job: JobWithOptionalSsh): number {
  const idleTimeoutSeconds = job.ssh?.idleTimeoutSeconds;
  if (idleTimeoutSeconds == null) {
    throw new SystemError('job.ssh.idleTimeoutSeconds is required when ssh is enabled on the job.');
  }
  if (
    !Number.isFinite(idleTimeoutSeconds) ||
    !Number.isInteger(idleTimeoutSeconds) ||
    idleTimeoutSeconds < 0 ||
    idleTimeoutSeconds > MAX_SSH_IDLE_TIMEOUT_SECONDS
  ) {
    throw new SystemError(
      `job.ssh.idleTimeoutSeconds must be an integer between 0 and ${MAX_SSH_IDLE_TIMEOUT_SECONDS}, got "${idleTimeoutSeconds}".`
    );
  }
  return idleTimeoutSeconds;
}

export function getSshRelayServerUrl(job: JobWithOptionalSsh): string {
  const relayServerUrl = job.ssh?.relayServerUrl;
  if (!relayServerUrl) {
    throw new SystemError(
      'job.ssh.relayServerUrl is required when ssh is enabled on the job. The worker dials our SSH relay; the public upterm host is not allowed.'
    );
  }
  return relayServerUrl;
}

export function getTurtleSshTarget({
  buildId,
  hasPlatform,
}: {
  buildId: string;
  hasPlatform: boolean;
}): TurtleSshTarget {
  if (hasPlatform) {
    return { turtleBuildId: buildId };
  }
  return { turtleJobRunId: buildId };
}

export type SshSessionHandle = {
  getConnectedClientCountAsync: () => Promise<number | null>;
  ensureConnectedAsync: () => Promise<void>;
  stopAsync: () => Promise<void>;
};

export type StartedSshSession = {
  handle: SshSessionHandle;
  idleTimeoutSeconds: number;
};

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
      turtleJobRunId: target.turtleJobRunId ?? null,
      turtleBuildId: target.turtleBuildId ?? null,
      connectionConfig: {
        ...connectionConfig,
        type: 'UPTERM_V1',
      },
      sessionSettings: { idleTimeoutSeconds },
    })
    .toPromise();
  if (result.error || !result.data) {
    throw new SystemError(
      `Failed to create or update the SSH session: ${result.error?.message ?? 'no data returned'}`
    );
  }
  const session = result.data.turtleSshSession.createOrUpdateTurtleSshSession as {
    sessionSettings: Pick<SshSettings, 'idleTimeoutSeconds'>;
  };
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

/**
 * Keeps the tunnel alive for as long as the session should stay reachable, and resolves once it
 * should be torn down. The idle timeout only starts counting once the job has finished, so the
 * tunnel is reachable for the whole job even when `idleTimeoutSeconds` is 0.
 */
export async function superviseSshSessionAsync({
  getConnectedClientCount,
  ensureConnected,
  idleTimeoutSeconds,
  hasJobFinished,
  logger,
}: {
  getConnectedClientCount: () => Promise<number | null>;
  ensureConnected: () => Promise<void>;
  idleTimeoutSeconds: number;
  hasJobFinished: () => boolean;
  logger: bunyan;
}): Promise<void> {
  const idleTimeoutMs = idleTimeoutSeconds * 1_000;
  // When idle is 0, still allow a short window of unknown polls so a single failed
  // `session current` does not tear down a live client. Cap it so we cannot hang forever.
  const unknownGraceMs =
    idleTimeoutSeconds === 0
      ? UNKNOWN_CLIENT_COUNT_GRACE_MS
      : Math.max(idleTimeoutMs, UNKNOWN_CLIENT_COUNT_GRACE_MS);
  let idleSince: number | null = null;
  let unknownSince: number | null = null;
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
      previousClientCount = connectedClientCount;
    }

    const jobHasFinished = hasJobFinished();
    if (connectedClientCount !== null && connectedClientCount > 0) {
      idleSince = null;
      unknownSince = null;
    } else if (connectedClientCount === 0) {
      unknownSince = null;
      if (!jobHasFinished) {
        idleSince = null;
      } else if (idleSince === null) {
        idleSince = Date.now();
      }
    } else {
      // null = unknown: do not treat as idle (could still have a live client), but bound the wait.
      idleSince = null;
      if (!jobHasFinished) {
        unknownSince = null;
      } else if (unknownSince === null) {
        unknownSince = Date.now();
      }
    }

    if (jobHasFinished && connectedClientCount === 0) {
      if (idleTimeoutSeconds === 0) {
        logger.info('The job finished and no SSH client is connected. Closing the session.');
        return;
      }
      if (idleSince !== null && Date.now() - idleSince >= idleTimeoutMs) {
        logger.info(
          `No SSH client connected for ${formatSshIdleTimeoutForLog(idleTimeoutSeconds)} after the job finished. Closing the session.`
        );
        return;
      }
    }
    if (
      jobHasFinished &&
      connectedClientCount === null &&
      unknownSince !== null &&
      Date.now() - unknownSince >= unknownGraceMs
    ) {
      logger.info(
        'Could not determine whether an SSH client is still connected after the job finished. Closing the session.'
      );
      return;
    }
    await sleepAsync(CLIENT_COUNT_POLL_INTERVAL_MS);
  }
}
