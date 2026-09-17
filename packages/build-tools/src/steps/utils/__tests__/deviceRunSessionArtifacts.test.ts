import fetch from 'node-fetch';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';

jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

describe(uploadDeviceRunSessionArtifactAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it.each([false, true])('streams an artifact with cancellation enabled: %s', async cancelable => {
    const controller = new AbortController();
    const signal = cancelable ? controller.signal : undefined;
    const stream = Readable.from(Buffer.from('artifact-data'));
    const reportedSize = 1024;
    const mutation = jest.fn().mockReturnValue({
      toPromise: async () => ({
        data: {
          deviceRunSession: {
            createArtifactUploadSession: {
              uploadSession: {
                url: 'https://uploads.expo.test/artifact',
                headers: {
                  'Content-Length': String(reportedSize),
                  'Content-Type': 'application/octet-stream',
                },
              },
            },
          },
        },
      }),
    });
    const ctx = {
      graphqlClient: {
        mutation,
      },
    } as unknown as CustomBuildContext;

    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadDeviceRunSessionArtifactAsync(ctx, {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'Artifact report.json (artifact-id)',
      filename: 'report.json',
      kind: 'agent-device-test-report',
      metadata: { firstFrameRecordAt: 'test-time' },
      size: reportedSize,
      stream,
      signal,
    });

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceRunSessionId: 'drs-id',
        input: {
          name: 'Artifact report.json (artifact-id)',
          filename: 'report.json',
          kind: 'agent-device-test-report',
          metadata: { firstFrameRecordAt: 'test-time' },
          size: reportedSize,
        },
      }),
      cancelable ? { fetch: expect.any(Function) } : undefined
    );
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      'https://uploads.expo.test/artifact',
      expect.objectContaining({
        method: 'PUT',
        body: stream,
        ...(signal ? { signal } : {}),
      })
    );
    if (cancelable) {
      const requestFetch = mutation.mock.calls[0][2].fetch as typeof globalThis.fetch;
      const nativeFetch = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new globalThis.Response());
      try {
        const requestController = new AbortController();
        await requestFetch('https://api.expo.test/graphql', {
          headers: { Authorization: 'Bearer test-token' },
          signal: requestController.signal,
        });
        expect(nativeFetch).toHaveBeenCalledWith(
          'https://api.expo.test/graphql',
          expect.objectContaining({
            headers: { Authorization: 'Bearer test-token' },
          })
        );
        const forwardedSignal = nativeFetch.mock.calls[0][1]!.signal!;
        expect(forwardedSignal.aborted).toBe(false);
        controller.abort();
        expect(forwardedSignal.aborted).toBe(true);
      } finally {
        nativeFetch.mockRestore();
      }
    }
  });

  it('does not allocate an upload after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const mutation = jest.fn();
    await expect(
      uploadDeviceRunSessionArtifactAsync(
        { graphqlClient: { mutation } } as unknown as CustomBuildContext,
        {
          deviceRunSessionId: 'run',
          artifactId: 'log',
          name: 'log',
          filename: 'app.log',
          kind: 'native-app-log',
          size: 1,
          stream: Readable.from(['x']),
          signal: controller.signal,
        }
      )
    ).rejects.toThrow();
    expect(mutation).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
