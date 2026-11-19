import { SystemError } from '@expo/eas-build-job';
import fetch from 'node-fetch';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { turtleFetch } from '../../../utils/turtleFetch';
import {
  DeviceRunSessionArtifactRejectedError,
  uploadDeviceRunSessionArtifactAsync,
} from '../deviceRunSessionArtifacts';
import { DEVICE_RUN_SESSION_TOKEN_HEADER } from '../deviceRunSessionWorkerApi';

jest.mock('node-fetch');
jest.mock('../../../utils/turtleFetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const TOKEN = 'device-run-session-token-value';

function jsonResponse(body: unknown, status = 200): InstanceType<typeof Response> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const uploadSessionResponse = () =>
  jsonResponse({ data: { uploadSession: { url: 'https://uploads.expo.test/a', headers: {} } } });

const artifact = {
  deviceRunSessionId: 'drs-id',
  artifactId: 'artifact-id',
  name: 'Screenshot',
  filename: 'screenshot.png',
  kind: 'screenshot',
  size: 0,
  openStream: () => Readable.from([]),
};

function createCtx(): CustomBuildContext {
  return {
    env: { EAS_DEVICE_RUN_SESSION_TOKEN: TOKEN },
    expoApiV2BaseUrl: 'https://api.expo.test/v2/',
  } as unknown as CustomBuildContext;
}

describe(uploadDeviceRunSessionArtifactAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
    jest.mocked(turtleFetch).mockReset();
  });

  it('streams an artifact through a signed upload URL', async () => {
    const stream = Readable.from(Buffer.from('artifact-data'));
    const reportedSize = 1024;
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse({
        data: {
          uploadSession: {
            url: 'https://uploads.expo.test/artifact',
            headers: {
              'Content-Length': String(reportedSize),
              'Content-Type': 'application/octet-stream',
            },
          },
        },
      })
    );
    jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 200 }));

    await uploadDeviceRunSessionArtifactAsync(createCtx(), {
      deviceRunSessionId: 'drs-id',
      artifactId: 'artifact-id',
      name: 'Artifact report.json (artifact-id)',
      filename: 'report.json',
      kind: 'agent-device-test-report',
      metadata: { firstFrameRecordAt: 'test-time' },
      size: reportedSize,
      openStream: () => stream,
      idempotencyKey: 'idempotency-key',
    });

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/device-run-session-worker/artifact-upload-sessions',
      'POST',
      expect.objectContaining({
        headers: {
          [DEVICE_RUN_SESSION_TOKEN_HEADER]: TOKEN,
          'Idempotency-Key': 'idempotency-key',
        },
        json: {
          name: 'Artifact report.json (artifact-id)',
          filename: 'report.json',
          kind: 'agent-device-test-report',
          metadata: { firstFrameRecordAt: 'test-time' },
          size: reportedSize,
        },
        signal: expect.any(AbortSignal),
      })
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
    jest.mocked(turtleFetch).mockImplementationOnce(async () => {
      controller.abort();
      return jsonResponse({
        data: {
          uploadSession: {
            url: 'https://uploads.expo.test/artifact',
            headers: {},
          },
        },
      });
    });
    await expect(
      uploadDeviceRunSessionArtifactAsync(createCtx(), {
        deviceRunSessionId: 'session',
        artifactId: 'id',
        name: 'Logs',
        filename: 'logs.ndjson',
        kind: 'simulator-log',
        size: 0,
        openStream: () => Readable.from([]),
        signal: controller.signal,
      })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const allocationSignal = jest.mocked(turtleFetch).mock.calls[0][2].signal;
    expect(allocationSignal).toBeInstanceOf(AbortSignal);
    expect(allocationSignal?.aborted).toBe(true);
  });

  it('sends a new idempotency key for each upload without one', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(uploadSessionResponse())
      .mockResolvedValueOnce(uploadSessionResponse());
    jest.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));

    await uploadDeviceRunSessionArtifactAsync(createCtx(), artifact);
    await uploadDeviceRunSessionArtifactAsync(createCtx(), artifact);

    const [first, second] = jest
      .mocked(turtleFetch)
      .mock.calls.map(
        ([, , options]) => (options.headers as Record<string, string>)['Idempotency-Key']
      );
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('reports an artifact name conflict as a rejected upload session', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(
      jsonResponse(
        {
          errors: [
            {
              code: 'ARTIFACT_NAME_CONFLICT',
              message:
                'Device run session already has an artifact named "Screenshot". Use a different name for this artifact.',
            },
          ],
        },
        409
      )
    );

    await expect(uploadDeviceRunSessionArtifactAsync(createCtx(), artifact)).rejects.toBeInstanceOf(
      DeviceRunSessionArtifactRejectedError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { status: 409, code: 'OTHER_CONFLICT' },
    { status: 400, code: 'VALIDATION_ERROR' },
    { status: 500, code: 'UNEXPECTED_ERROR' },
  ])(
    'does not report HTTP $status $code as a rejected upload session',
    async ({ status, code }) => {
      jest
        .mocked(turtleFetch)
        .mockResolvedValueOnce(jsonResponse({ errors: [{ code, message: 'Failed.' }] }, status));

      const error = await uploadDeviceRunSessionArtifactAsync(createCtx(), artifact).catch(
        (err: unknown) => err
      );

      expect(error).toBeInstanceOf(SystemError);
      expect(error).not.toBeInstanceOf(DeviceRunSessionArtifactRejectedError);
    }
  );
});
