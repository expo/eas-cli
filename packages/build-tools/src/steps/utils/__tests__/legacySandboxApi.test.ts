import { type Client, CombinedError } from '@urql/core';

import { LegacySandboxApi } from '../legacySandboxApi';
import { WorkerApiError } from '../workerApi';

const ARTIFACT_ID = '0199c0de-7b3a-7c1e-8f00-1234567890ab';

describe(LegacySandboxApi, () => {
  let mutation: jest.Mock;
  let api: LegacySandboxApi;

  beforeEach(() => {
    mutation = jest.fn();
    api = new LegacySandboxApi({ mutation } as unknown as Client, 'sandbox-id');
  });

  function mockMutationResults(...results: unknown[]): void {
    for (const result of results) {
      mutation.mockReturnValueOnce({ toPromise: async () => result });
    }
  }

  it('marks the sandbox ready and rethrows a GraphQL error', async () => {
    const error = new CombinedError({ graphQLErrors: ['Sandbox has stopped.'] });
    mockMutationResults({ data: {} }, { error });

    await api.markReadyAsync();
    await expect(api.markReadyAsync()).rejects.toBe(error);

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxId: 'sandbox-id' },
      undefined
    );
  });

  it('creates an upload session for the sandbox', async () => {
    mockMutationResults({
      data: {
        sandbox: {
          createArtifactUploadSession: {
            artifact: { id: ARTIFACT_ID },
            uploadSession: { url: 'https://uploads.expo.test/artifact', headers: { A: '1' } },
          },
        },
      },
    });

    await expect(
      api.createArtifactUploadSessionAsync({ name: 'Crash log', filename: 'crash.log', size: 5 })
    ).resolves.toEqual({
      artifact: { id: ARTIFACT_ID },
      uploadSession: { url: 'https://uploads.expo.test/artifact', headers: { A: '1' } },
    });
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxId: 'sandbox-id', input: { name: 'Crash log', filename: 'crash.log', size: 5 } },
      expect.anything()
    );
  });

  it.each([
    { codes: ['VALIDATION_ERROR'], code: 'VALIDATION_ERROR' },
    { codes: ['VALIDATION_ERROR', 'UNEXPECTED_ERROR'], code: undefined },
  ])(
    'reports upload session errors with codes $codes as a worker API error with code $code',
    async ({ codes, code }) => {
      mockMutationResults({
        error: new CombinedError({
          graphQLErrors: codes.map((errorCode, index) => ({
            message: `Error ${index}.`,
            extensions: { errorCode },
          })),
        }),
      });

      const error = await api
        .createArtifactUploadSessionAsync({ name: 'Crash log', filename: 'crash.log', size: 5 })
        .catch(err => err);

      expect(error).toBeInstanceOf(WorkerApiError);
      expect(error.code).toBe(code);
      expect(error.message).toBe(codes.map((_, index) => `Error ${index}.`).join('\n'));
    }
  );

  it('retries finalize after a server error and throws a failure that persists', async () => {
    const persistent = new CombinedError({
      graphQLErrors: ['Sandbox artifact "Crash log" has no uploaded file.'],
      response: { status: 200 },
    });
    mockMutationResults(
      {
        error: new CombinedError({
          networkError: new Error('Bad Gateway'),
          response: { status: 502 },
        }),
      },
      { error: persistent }
    );

    await expect(api.finalizeArtifactAsync(ARTIFACT_ID)).rejects.toBe(persistent);
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      { artifactId: ARTIFACT_ID },
      expect.anything()
    );
  });

  it('rejects a finalized artifact without a download URL', async () => {
    mockMutationResults({
      data: { sandbox: { finalizeArtifact: { id: ARTIFACT_ID, downloadUrl: null } } },
    });

    await expect(api.finalizeArtifactAsync(ARTIFACT_ID)).rejects.toThrow(
      `Finalized sandbox artifact ${ARTIFACT_ID} has no download URL.`
    );
  });
});
