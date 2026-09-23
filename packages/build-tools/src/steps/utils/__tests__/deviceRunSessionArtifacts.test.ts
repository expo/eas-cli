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

  it('streams an artifact through a signed upload URL', async () => {
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
      undefined
    );
    expect(jest.mocked(fetch)).toHaveBeenCalledWith(
      'https://uploads.expo.test/artifact',
      expect.objectContaining({
        method: 'PUT',
        body: stream,
      })
    );
  });

  it('forwards cancellation through upload allocation and skips PUT when allocation aborts', async () => {
    const controller = new AbortController();
    const mutation = jest.fn().mockReturnValue({
      toPromise: async () => {
        controller.abort();
        return {
          data: {
            deviceRunSession: {
              createArtifactUploadSession: {
                uploadSession: {
                  url: 'https://uploads.expo.test/artifact',
                  headers: {},
                },
              },
            },
          },
        };
      },
    });
    const ctx = { graphqlClient: { mutation } } as unknown as CustomBuildContext;
    await expect(
      uploadDeviceRunSessionArtifactAsync(ctx, {
        deviceRunSessionId: 'session',
        artifactId: 'id',
        name: 'Logs',
        filename: 'logs.ndjson',
        kind: 'simulator-log',
        size: 0,
        stream: Readable.from([]),
        signal: controller.signal,
      })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const allocationFetch = mutation.mock.calls[0][2].fetch;
    const mockFetch = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('aborted'));
    try {
      await expect(allocationFetch('https://api.expo.test/graphql', {})).rejects.toThrow('aborted');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.expo.test/graphql',
        expect.objectContaining({
          signal: expect.objectContaining({ aborted: true }),
        })
      );
    } finally {
      mockFetch.mockRestore();
    }
  });
});
