import { type Env, SystemError } from '@expo/eas-build-job';
import { type Client, CombinedError } from '@urql/core';
import { graphql } from 'gql.tada';
import { setTimeout as delay } from 'node:timers/promises';

import { graphqlAbortContext } from '../../utils/graphqlAbort';
import { type SandboxArtifactUploadSession } from './sandboxWorkerApi';
import { WorkerApiError, type WorkerApiRequestOptions } from './workerApi';

const MARK_SANDBOX_READY_MUTATION = graphql(`
  mutation MarkSandboxReady($sandboxId: ID!) {
    sandbox {
      markSandboxReady(sandboxId: $sandboxId) {
        id
      }
    }
  }
`);

const CREATE_SANDBOX_ARTIFACT_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateSandboxArtifactUploadSession(
    $sandboxId: ID!
    $input: CreateSandboxArtifactUploadSessionInput!
  ) {
    sandbox {
      createArtifactUploadSession(sandboxId: $sandboxId, input: $input) {
        artifact {
          id
        }
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

const FINALIZE_SANDBOX_ARTIFACT_MUTATION = graphql(`
  mutation FinalizeSandboxArtifact($artifactId: ID!) {
    sandbox {
      finalizeArtifact(artifactId: $artifactId) {
        id
        downloadUrl
      }
    }
  }
`);

const FINALIZE_ATTEMPTS = 3;
const FINALIZE_TIMEOUT_MS = 15_000;

export class LegacySandboxApi {
  constructor(
    private readonly graphqlClient: Client,
    private readonly sandboxId: string
  ) {}

  public async markReadyAsync({ signal }: WorkerApiRequestOptions = {}): Promise<void> {
    signal?.throwIfAborted();
    const result = await this.graphqlClient
      .mutation(
        MARK_SANDBOX_READY_MUTATION,
        { sandboxId: this.sandboxId },
        graphqlAbortContext(signal)
      )
      .toPromise();
    signal?.throwIfAborted();
    if (result.error) {
      throw result.error;
    }
  }

  public async createArtifactUploadSessionAsync(
    input: { name: string; filename: string; size: number },
    { signal, timeoutMs }: WorkerApiRequestOptions = {}
  ): Promise<SandboxArtifactUploadSession> {
    const requestSignal = AbortSignal.any([
      ...(signal ? [signal] : []),
      ...(timeoutMs !== undefined ? [AbortSignal.timeout(timeoutMs)] : []),
    ]);
    const result = await this.graphqlClient
      .mutation(
        CREATE_SANDBOX_ARTIFACT_UPLOAD_SESSION_MUTATION,
        { sandboxId: this.sandboxId, input },
        graphqlAbortContext(requestSignal)
      )
      .toPromise();
    requestSignal.throwIfAborted();
    if (result.error) {
      const { graphQLErrors } = result.error;
      const codes = Array.from(new Set(graphQLErrors.map(error => error.extensions?.errorCode)));
      throw new WorkerApiError(
        graphQLErrors.length > 0
          ? graphQLErrors.map(error => error.message).join('\n')
          : result.error.message,
        result.error.response?.status,
        { cause: result.error },
        codes.length === 1 && typeof codes[0] === 'string' ? codes[0] : undefined
      );
    }
    const { artifact, uploadSession } = result.data!.sandbox.createArtifactUploadSession;
    return {
      artifact,
      uploadSession: {
        url: uploadSession.url,
        headers: uploadSession.headers as Record<string, string>,
      },
    };
  }

  public async finalizeArtifactAsync(
    artifactId: string,
    { signal }: WorkerApiRequestOptions = {}
  ): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const timeoutSignal = AbortSignal.timeout(FINALIZE_TIMEOUT_MS);
      const finalizeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      try {
        const result = await this.graphqlClient
          .mutation(
            FINALIZE_SANDBOX_ARTIFACT_MUTATION,
            { artifactId },
            graphqlAbortContext(finalizeSignal)
          )
          .toPromise();
        finalizeSignal.throwIfAborted();
        if (result.error) {
          throw result.error;
        }
        const { downloadUrl } = result.data!.sandbox.finalizeArtifact;
        if (downloadUrl === null) {
          throw new SystemError(`Finalized sandbox artifact ${artifactId} has no download URL.`);
        }
        return downloadUrl;
      } catch (error) {
        signal?.throwIfAborted();
        const retryable =
          timeoutSignal.aborted ||
          (error instanceof CombinedError && isTransientGraphqlError(error));
        if (!retryable || attempt >= FINALIZE_ATTEMPTS) {
          throw error;
        }
        await delay(500 * attempt, undefined, { signal });
      }
    }
  }
}

export function getLegacySandboxConnection({
  graphqlClient,
  env,
  sandboxId,
}: {
  graphqlClient: Client;
  env: Env;
  sandboxId: string;
}): { sandboxApi: LegacySandboxApi; credential: string; commandEnv: Env } {
  const { __EAS_SANDBOX_MCP_TOKEN: credential, ...commandEnv } = env;
  if (!credential) {
    throw new SystemError(
      'This sandbox job has neither EAS_SANDBOX_WORKER_TOKEN nor __EAS_SANDBOX_MCP_TOKEN. ' +
        'www gives one of them to every sandbox job. Start a new sandbox, and contact support if ' +
        'it happens again.'
    );
  }
  return { sandboxApi: new LegacySandboxApi(graphqlClient, sandboxId), credential, commandEnv };
}

function isTransientGraphqlError(error: CombinedError): boolean {
  const status: number | undefined = error.response?.status;
  return status === undefined ? error.networkError !== undefined : status >= 500;
}
