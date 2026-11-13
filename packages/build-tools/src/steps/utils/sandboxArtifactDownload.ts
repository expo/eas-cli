import { SystemError, UserError, formatBytes } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { Client, CombinedError } from '@urql/core';
import { graphql } from 'gql.tada';
import fetch from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import stream from 'stream';
import { promisify } from 'util';
import { z } from 'zod';

import { graphqlAbortContext } from '../../utils/graphqlAbort';
import {
  describeError,
  isTransferFailure,
  isTransientGraphqlError,
} from '../../utils/networkErrors';
import { retryOnNetworkFailureAsync } from '../../utils/retryOnNetworkFailure';

const streamPipeline = promisify(stream.pipeline);

const UPLOAD_WAIT_LIMIT_MS = 120_000;
const UPLOAD_WAIT_POLL_INTERVAL_MS = 5_000;
// www finalizes pending uploads right after the sandbox job reaches a final status, so a
// download URL that is still missing after this time means the upload failed.
const FINAL_SANDBOX_UPLOAD_WAIT_LIMIT_MS = 10_000;
const FINAL_SANDBOX_UPLOAD_WAIT_POLL_INTERVAL_MS = 2_000;
const FINAL_SANDBOX_STATUSES: ReadonlySet<string> = new Set(['STOPPED', 'ERRORED']);

const FALLBACK_ARTIFACT_FILENAME = 'artifact';
const MAX_ARTIFACT_FILENAME_LENGTH = 255;

export type SandboxArtifactSource =
  | { artifactId: string; agentRunId?: never; name?: never }
  | { artifactId?: never; agentRunId: string; name: string };

const AGENT_RUN_SANDBOX_ARTIFACTS_QUERY = graphql(`
  query DownloadSandboxArtifactAgentRunSandboxesQuery($agentRunId: ID!) {
    agentRuns {
      byId(agentRunId: $agentRunId) {
        id
        sandboxes {
          id
          status
          createdAt
          artifacts {
            id
            name
          }
        }
      }
    }
  }
`);

const SANDBOX_ARTIFACT_BY_ID_QUERY = graphql(`
  query DownloadSandboxArtifactByIdQuery($sandboxArtifactId: ID!) {
    sandboxArtifacts {
      byId(sandboxArtifactId: $sandboxArtifactId) {
        id
        name
        filename
        downloadUrl
        sandbox {
          id
          status
        }
      }
    }
  }
`);

type SandboxArtifact = {
  id: string;
  name: string;
  filename: string;
  downloadUrl: string | null;
  sandbox: { id: string; status: string };
};

type AgentRunSandbox = {
  id: string;
  status: string;
  createdAt: unknown;
  artifacts: { id: string; name: string }[];
};

/**
 * Downloads one sandbox artifact into a new temporary directory. The artifact is found by its ID,
 * or by its name in the sandboxes of an agent run.
 *
 * The file is written as is. A sandbox supplies the content, the name and the filename of an
 * artifact, so all three are untrusted, and archives are not extracted.
 */
export async function downloadSandboxArtifactAsync(
  params: SandboxArtifactSource & {
    logger: bunyan;
    graphqlClient: Client;
    /** Stops the lookups, the wait, the request and the file write when aborted. */
    signal?: AbortSignal;
  }
): Promise<{ artifactId: string; artifactPath: string }> {
  const { logger, graphqlClient, signal } = params;

  const artifactId =
    params.artifactId !== undefined
      ? params.artifactId
      : await findSandboxArtifactIdByNameAsync({
          agentRunId: params.agentRunId,
          name: params.name,
          logger,
          graphqlClient,
          signal,
        });
  const artifact = await waitForSandboxArtifactUploadAsync({
    artifactId,
    logger,
    graphqlClient,
    signal,
  });

  const downloadDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_sandbox_artifact-')
  );
  const artifactPath = path.join(
    downloadDestinationDirectory,
    sanitizeSandboxArtifactFilename(artifact.filename)
  );

  // The download URL expires 15 minutes after www returns it. The wait has just fetched one, and
  // every later attempt fetches its own.
  let downloadUrl: string | null = artifact.downloadUrl;
  signal?.throwIfAborted();
  try {
    await retryOnNetworkFailureAsync(
      async () => {
        const attemptDownloadUrl =
          downloadUrl ??
          (await fetchSandboxArtifactAsync({ artifactId, graphqlClient, signal })).downloadUrl;
        downloadUrl = null;
        if (!attemptDownloadUrl) {
          throw new SystemError(
            `Sandbox artifact ${artifactId} had a download URL, but the next lookup returned none.`
          );
        }
        const response = await fetch(attemptDownloadUrl, { signal });
        if (!response.ok) {
          if (response.status === 404 || response.status === 410) {
            throw new UserError(
              'EAS_DOWNLOAD_SANDBOX_ARTIFACT_FILE_UNAVAILABLE',
              `Failed to download sandbox artifact ${artifactId} (HTTP ${response.status}). ` +
                'The file is unavailable. Sandbox artifact files are deleted 90 days after the ' +
                'upload, so run the agent again to create a new artifact.'
            );
          }
          const textResult = await asyncResult(response.text());
          throw new Error(
            `Failed to download sandbox artifact ${artifactId} (HTTP ${response.status}): ${textResult.value}`
          );
        }
        // On abort, node-fetch emits an error on the body stream, which fails the pipeline.
        await streamPipeline(response.body, fs.createWriteStream(artifactPath));
      },
      {
        operation: 'download_sandbox_artifact.file_download',
        signal,
        isRetryable: isTransferFailure,
      }
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (isTransferFailure(error)) {
      throw new SystemError(
        `Could not download sandbox artifact ${artifactId}: ${describeError(error)}`,
        { cause: error }
      );
    }
    throw error;
  }
  signal?.throwIfAborted();

  const { size } = await fs.promises.stat(artifactPath);
  logger.info(`Downloaded ${artifactPath} (${formatBytes(size)}).`);

  return { artifactId, artifactPath };
}

/**
 * Validates the raw inputs of a step. An empty value counts as missing, because an output that
 * does not exist interpolates to an empty value.
 */
export function parseSandboxArtifactSource({
  artifactId,
  agentRunId,
  name,
}: {
  artifactId?: string;
  agentRunId?: string;
  name?: string;
}): SandboxArtifactSource {
  if (artifactId) {
    if (agentRunId || name) {
      throw new UserError(
        'EAS_DOWNLOAD_SANDBOX_ARTIFACT_INVALID_SOURCE',
        'Pass artifact_id alone, or agent_run_id together with name, not both.'
      );
    }
    if (!z.string().uuid().safeParse(artifactId).success) {
      throw new UserError(
        'EAS_DOWNLOAD_SANDBOX_ARTIFACT_INVALID_SOURCE',
        'artifact_id must be a sandbox artifact ID.'
      );
    }
    return { artifactId };
  }

  if (!agentRunId || !name) {
    throw new UserError(
      'EAS_DOWNLOAD_SANDBOX_ARTIFACT_INVALID_SOURCE',
      'Pass artifact_id alone, or agent_run_id together with name.' +
        (name
          ? ' agent_run_id is empty. Check that it is the agent_run_id output of an agent job.'
          : agentRunId
            ? ' name is empty.'
            : '')
    );
  }
  if (!z.string().uuid().safeParse(agentRunId).success) {
    throw new UserError(
      'EAS_DOWNLOAD_SANDBOX_ARTIFACT_INVALID_SOURCE',
      'agent_run_id must be the agent_run_id output of an agent job.'
    );
  }
  return { agentRunId, name };
}

/**
 * A name is unique in one sandbox only, and sandbox content is untrusted: an agent under prompt
 * injection can upload a second artifact with the same name from another sandbox. More than one
 * match is therefore an error, never a reason to select the newest.
 */
async function findSandboxArtifactIdByNameAsync({
  agentRunId,
  name,
  logger,
  graphqlClient,
  signal,
}: {
  agentRunId: string;
  name: string;
  logger: bunyan;
  graphqlClient: Client;
  signal?: AbortSignal;
}): Promise<string> {
  logger.info(`Looking for sandbox artifact ${JSON.stringify(name)} in agent run ${agentRunId}...`);
  const data = await queryAsync({
    operation: 'download_sandbox_artifact.agent_run_lookup',
    failureMessage: `Could not fetch the sandboxes of agent run ${agentRunId}`,
    signal,
    queryAsync: () =>
      graphqlClient
        .query(AGENT_RUN_SANDBOX_ARTIFACTS_QUERY, { agentRunId }, graphqlAbortContext(signal))
        .toPromise(),
  });
  const sandboxes: AgentRunSandbox[] = data.agentRuns.byId.sandboxes;
  const matches = sandboxes.flatMap(sandbox =>
    sandbox.artifacts
      .filter(artifact => artifact.name === name)
      .map(artifact => ({ sandbox, artifact }))
  );

  if (matches.length === 0) {
    throw new UserError(
      'EAS_DOWNLOAD_SANDBOX_ARTIFACT_NOT_FOUND',
      `No sandbox of agent run ${agentRunId} has an artifact named ${JSON.stringify(name)} ` +
        `(sandboxes checked: ${sandboxes.length}). ` +
        'Check the logs of the agent job to see if the agent uploaded the artifact.'
    );
  }
  if (matches.length > 1) {
    throw new UserError(
      'EAS_DOWNLOAD_SANDBOX_ARTIFACT_AMBIGUOUS_NAME',
      `Agent run ${agentRunId} has ${matches.length} artifacts named ${JSON.stringify(name)}, ` +
        'expected one:\n' +
        matches
          .map(
            ({ sandbox, artifact }) =>
              `- artifact ${artifact.id} in sandbox ${sandbox.id} (${sandbox.status}, created ${sandbox.createdAt})`
          )
          .join('\n') +
        '\nReview the artifacts, then pass the ID of the correct one as artifact_id.'
    );
  }

  const [{ sandbox, artifact }] = matches;
  logger.info(`Found sandbox artifact ${artifact.id} in sandbox ${sandbox.id}.`);
  return artifact.id;
}

/**
 * `downloadUrl` is null until www finalizes the upload. www does that when the sandbox finalizes
 * the upload itself, or soon after the sandbox job reaches a final status.
 */
async function waitForSandboxArtifactUploadAsync({
  artifactId,
  logger,
  graphqlClient,
  signal,
}: {
  artifactId: string;
  logger: bunyan;
  graphqlClient: Client;
  signal?: AbortSignal;
}): Promise<SandboxArtifact & { downloadUrl: string }> {
  const deadline = Date.now() + UPLOAD_WAIT_LIMIT_MS;
  let finalSandboxDeadline: number | undefined;
  while (true) {
    const artifact = await fetchSandboxArtifactAsync({ artifactId, graphqlClient, signal });
    if (artifact.downloadUrl) {
      return { ...artifact, downloadUrl: artifact.downloadUrl };
    }

    const { sandbox } = artifact;
    const isSandboxFinal = FINAL_SANDBOX_STATUSES.has(sandbox.status);
    if (isSandboxFinal) {
      finalSandboxDeadline ??= Date.now() + FINAL_SANDBOX_UPLOAD_WAIT_LIMIT_MS;
    }
    if (Date.now() >= (finalSandboxDeadline ?? deadline)) {
      throw new UserError(
        'EAS_DOWNLOAD_SANDBOX_ARTIFACT_UPLOAD_NOT_FINISHED',
        `Sandbox artifact ${artifactId} has no file to download: the upload did not finish. ` +
          (isSandboxFinal
            ? `Sandbox ${sandbox.id} has the status ${sandbox.status}, so the upload cannot finish anymore. ` +
              'Check the logs of the agent job to see why the upload failed.'
            : `Sandbox ${sandbox.id} still has the status ${sandbox.status} after a wait of ` +
              `${UPLOAD_WAIT_LIMIT_MS / 1000} seconds. Run this job after the sandbox stops.`)
      );
    }

    logger.info(
      `The upload of sandbox artifact ${artifactId} is not finished (sandbox ${sandbox.id} is ${sandbox.status}), waiting...`
    );
    await setTimeoutAsync(
      isSandboxFinal ? FINAL_SANDBOX_UPLOAD_WAIT_POLL_INTERVAL_MS : UPLOAD_WAIT_POLL_INTERVAL_MS,
      undefined,
      { signal }
    );
  }
}

async function fetchSandboxArtifactAsync({
  artifactId,
  graphqlClient,
  signal,
}: {
  artifactId: string;
  graphqlClient: Client;
  signal?: AbortSignal;
}): Promise<SandboxArtifact> {
  const data = await queryAsync({
    operation: 'download_sandbox_artifact.artifact_lookup',
    failureMessage: `Could not fetch sandbox artifact ${artifactId}`,
    signal,
    queryAsync: () =>
      graphqlClient
        .query(
          SANDBOX_ARTIFACT_BY_ID_QUERY,
          { sandboxArtifactId: artifactId },
          graphqlAbortContext(signal)
        )
        .toPromise(),
  });
  return data.sandboxArtifacts.byId;
}

async function queryAsync<TData>({
  operation,
  failureMessage,
  signal,
  queryAsync,
}: {
  operation: string;
  failureMessage: string;
  signal?: AbortSignal;
  queryAsync: () => Promise<{ data?: TData; error?: CombinedError }>;
}): Promise<TData> {
  signal?.throwIfAborted();
  let data;
  try {
    data = await retryOnNetworkFailureAsync(
      async () => {
        const queryResult = await queryAsync();
        if (queryResult.error) {
          throw queryResult.error;
        }
        return queryResult.data;
      },
      {
        operation,
        signal,
        isRetryable: error => error instanceof CombinedError && isTransientGraphqlError(error),
      }
    );
  } catch (error) {
    signal?.throwIfAborted();
    const message = `${failureMessage}: ${describeError(error)}`;
    throw error instanceof CombinedError && !isTransientGraphqlError(error)
      ? new UserError('EAS_DOWNLOAD_SANDBOX_ARTIFACT_FETCH_FAILED', message, { cause: error })
      : new SystemError(message, { cause: error });
  }
  signal?.throwIfAborted();
  if (!data) {
    throw new SystemError(`${failureMessage}: the response has no data.`);
  }
  return data;
}

/**
 * Returns a name that is safe to join to a directory path. The sandbox supplies the filename, so
 * it can hold path separators of either platform, `..`, or characters that a shell interprets.
 */
export function sanitizeSandboxArtifactFilename(filename: string): string {
  const basename = filename.split(/[/\\]/).at(-1) ?? '';
  const sanitized = basename
    .replace(/[^a-z0-9._-]+/gi, '_')
    // A leading dot makes a hidden file or `..`, and a command can read a leading hyphen as an option.
    .replace(/^[.-]+/, '')
    .slice(0, MAX_ARTIFACT_FILENAME_LENGTH);
  return sanitized || FALLBACK_ARTIFACT_FILENAME;
}
