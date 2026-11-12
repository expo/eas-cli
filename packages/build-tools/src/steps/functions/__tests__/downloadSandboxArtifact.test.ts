import { Client } from '@urql/core';
import fetch, { Response } from 'node-fetch';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createDownloadSandboxArtifactFunction } from '../downloadSandboxArtifact';

function createStep(graphqlClient: Client, callInputs: Record<string, unknown>) {
  return createDownloadSandboxArtifactFunction({
    graphqlClient,
  } as any).createBuildStepFromFunctionCall(
    createGlobalContextMock({ logger: createMockLogger(), staticContextContent: { job: {} } }),
    { callInputs }
  );
}

function createMockGraphqlClient({
  agentRunId,
  artifactId,
}: {
  agentRunId: string;
  artifactId: string;
}): Client {
  return {
    query: jest.fn((_query, variables: { agentRunId?: string }) => ({
      toPromise: async () => ({
        data: variables.agentRunId
          ? {
              agentRuns: {
                byId: {
                  id: agentRunId,
                  sandboxes: [
                    {
                      id: randomUUID(),
                      status: 'STOPPED',
                      createdAt: '2026-11-12T10:00:00.000Z',
                      artifacts: [{ id: artifactId, name: 'sentry-123.bundle' }],
                    },
                  ],
                },
              },
            }
          : {
              sandboxArtifacts: {
                byId: {
                  id: artifactId,
                  name: 'sentry-123.bundle',
                  filename: 'sentry-123.bundle',
                  downloadUrl: 'https://storage.example.test/file',
                  sandbox: { id: randomUUID(), status: 'STOPPED' },
                },
              },
            },
      }),
    })),
  } as unknown as Client;
}

afterEach(() => {
  jest.mocked(fetch).mockReset();
});

describe(createDownloadSandboxArtifactFunction, () => {
  it.each([
    ['artifact_id', (ids: { artifactId: string }) => ({ artifact_id: ids.artifactId })],
    [
      'agent_run_id and name',
      (ids: { agentRunId: string }) => ({
        agent_run_id: ids.agentRunId,
        name: 'sentry-123.bundle',
      }),
    ],
  ])('sets artifact_id and artifact_path for %s', async (_description, createCallInputs) => {
    const ids = { agentRunId: randomUUID(), artifactId: randomUUID() };
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: Readable.from('bundle content'),
    } as unknown as Response);
    const step = createStep(createMockGraphqlClient(ids), createCallInputs(ids));

    await step.executeAsync();

    expect(step.outputById.artifact_id.value).toBe(ids.artifactId);
    const artifactPath = step.outputById.artifact_path.value!;
    expect(artifactPath).toMatch(/\/download_sandbox_artifact-[^/]+\/sentry-123\.bundle$/);
    expect(await fs.promises.readFile(artifactPath, 'utf8')).toBe('bundle content');
  });

  it.each([
    ['no inputs', {}],
    ['agent_run_id without name', { agent_run_id: randomUUID() }],
    // An agent job without the agent_run_id output interpolates to an empty value.
    ['name with an empty agent_run_id', { agent_run_id: '', name: 'sentry-123.bundle' }],
    [
      'artifact_id with agent_run_id and name',
      { artifact_id: randomUUID(), agent_run_id: randomUUID(), name: 'sentry-123.bundle' },
    ],
  ])('rejects %s', async (_description, callInputs) => {
    const graphqlClient = createMockGraphqlClient({
      agentRunId: randomUUID(),
      artifactId: randomUUID(),
    });

    await expect(createStep(graphqlClient, callInputs).executeAsync()).rejects.toMatchObject({
      errorCode: 'EAS_DOWNLOAD_SANDBOX_ARTIFACT_INVALID_SOURCE',
    });
    expect(graphqlClient.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
