import { SystemError, UserError, formatBytes } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { Client, CombinedError } from '@urql/core';
import { graphql } from 'gql.tada';
import fetch, { FetchError } from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import stream from 'stream';
import { promisify } from 'util';
import { z } from 'zod';

import { graphqlAbortContext } from '../../utils/graphqlAbort';
import {
  describeError,
  findErrorCode,
  isTransferFailure,
  isTransientGraphqlError,
} from '../../utils/networkErrors';
import { retryOnNetworkFailureAsync } from '../../utils/retryOnNetworkFailure';

const streamPipeline = promisify(stream.pipeline);

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
            filename
            downloadUrl
            fileSizeBytes
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
  filename: string;
  downloadUrl: string | null;
  sandbox: { id: string; status: string };
};

type AgentRunSandbox = {
  id: string;
  status: string;
  createdAt: unknown;
  artifacts: {
    id: string;
    name: string;
    filename: string;
    downloadUrl: string | null;
    fileSizeBytes: unknown;
  }[];
};

export async function downloadSandboxArtifactAsync(
  params: SandboxArtifactSource & {
    logger: bunyan;
    graphqlClient: Client;
    signal?: AbortSignal;
  }
): Promise<{ artifactId: string; artifactPath: string }> {
  const { logger, graphqlClient, signal } = params;

  const artifact =
    params.artifactId !== undefined
      ? await fetchSandboxArtifactAsync({ artifactId: params.artifactId, graphqlClient, signal })
      : await findSandboxArtifactByNameAsync({
          agentRunId: params.agentRunId,
          name: params.name,
          logger,
          graphqlClient,
          signal,
        });
  const { id: artifactId, downloadUrl } = artifact;
  if (!downloadUrl) {
    throw new UserError(
      'EAS_DOWNLOAD_SANDBOX_ARTIFACT_UPLOAD_NOT_FINISHED',
      `Sandbox artifact ${artifactId} has no file to download: the upload did not finish. ` +
        `Sandbox ${artifact.sandbox.id} has the status ${artifact.sandbox.status}. ` +
        'Check the logs of the agent job to see why the upload did not finish.'
    );
  }

  const downloadDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'download_sandbox_artifact-')
  );
  const artifactPath = path.join(
    downloadDestinationDirectory,
    sanitizeSandboxArtifactFilename(artifact.filename)
  );

  signal?.throwIfAborted();
  try {
    await retryOnNetworkFailureAsync(
      async () => {
        const response = await fetch(downloadUrl, { signal });
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
          const message = `Failed to download sandbox artifact ${artifactId} (HTTP ${response.status}): ${textResult.value}`;
          throw response.status >= 500 ? new SystemError(message) : new Error(message);
        }
        await streamPipeline(response.body, fs.createWriteStream(artifactPath));
      },
      {
        operation: 'download_sandbox_artifact.file_download',
        signal,
        isRetryable: error => isTransferFailure(error) || error instanceof SystemError,
      }
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (isTransferFailure(error) || error instanceof FetchError) {
      throw new SystemError(
        `Could not download sandbox artifact ${artifactId}: ${findErrorCode(error) ?? 'network error'}.`
      );
    }
    throw error;
  }
  signal?.throwIfAborted();

  const { size } = await fs.promises.stat(artifactPath);
  logger.info(`Downloaded ${artifactPath} (${formatBytes(size)}).`);

  return { artifactId, artifactPath };
}

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

async function findSandboxArtifactByNameAsync({
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
}): Promise<SandboxArtifact> {
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
  const nameMatches = sandboxes.flatMap(sandbox =>
    sandbox.artifacts
      .filter(artifact => artifact.name === name)
      .map(artifact => ({ sandbox, artifact }))
  );
  // www keeps the artifact record of a failed upload, with no file
  const matchesWithFile = nameMatches.filter(({ artifact }) => artifact.fileSizeBytes !== null);
  const matches = matchesWithFile.length > 0 ? matchesWithFile : nameMatches;

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
  return { ...artifact, sandbox };
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

export function sanitizeSandboxArtifactFilename(filename: string): string {
  const basename = filename.split(/[/\\]/).at(-1) ?? '';
  const sanitized = basename.replace(/[^a-z0-9._-]+/gi, '_').slice(0, MAX_ARTIFACT_FILENAME_LENGTH);
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return FALLBACK_ARTIFACT_FILENAME;
  }
  return sanitized;
}
