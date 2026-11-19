import { ArchiveSourceType, EnvironmentSecretType, type Job } from '@expo/eas-build-job';

import { turtleFetch } from '../../../utils/turtleFetch';
import { SandboxWorkerApi, getSandboxWorkerApi } from '../sandboxWorkerApi';

jest.mock('../../../utils/turtleFetch');
jest.unmock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const BASE_URL = 'https://api.expo.test/v2/';
const TOKEN = 'sandbox-worker-token-value';
const ARTIFACT_ID = '0199c0de-7b3a-7c1e-8f00-1234567890ab';

function jsonResponse(body: unknown): InstanceType<typeof Response> {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe(getSandboxWorkerApi, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it('returns null when the job has no sandbox worker token', () => {
    expect(
      getSandboxWorkerApi({
        job: { secrets: { environmentSecrets: [] } } as unknown as Job,
        env: { EAS_SANDBOX_WORKER_TOKEN: TOKEN },
        expoApiV2BaseUrl: BASE_URL,
      })
    ).toBeNull();
  });

  it('reads the token from the job secrets', async () => {
    jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data: { id: 'sandbox-id' } }));
    const api = getSandboxWorkerApi({
      job: {
        secrets: {
          environmentSecrets: [
            { name: 'EAS_SANDBOX_WORKER_TOKEN', type: EnvironmentSecretType.STRING, value: TOKEN },
          ],
        },
      } as unknown as Job,
      env: {},
      expoApiV2BaseUrl: BASE_URL,
    });

    await api!.markReadyAsync();

    expect(jest.mocked(turtleFetch)).toHaveBeenCalledWith(
      'https://api.expo.test/v2/sandbox-worker/ready',
      'POST',
      expect.objectContaining({ headers: { 'expo-sandbox-worker-token': TOKEN } })
    );
  });
});

describe(SandboxWorkerApi, () => {
  beforeEach(() => {
    jest.mocked(turtleFetch).mockReset();
  });

  it.each([
    {
      name: 'getProjectArchiveSourceAsync',
      call: (api: SandboxWorkerApi) => api.getProjectArchiveSourceAsync(),
      route: 'project-archive',
      json: undefined,
      data: { type: ArchiveSourceType.URL, url: 'https://storage.expo.test/project.tar.gz' },
      expected: { type: ArchiveSourceType.URL, url: 'https://storage.expo.test/project.tar.gz' },
    },
    {
      name: 'markReadyAsync',
      call: (api: SandboxWorkerApi) => api.markReadyAsync(),
      route: 'ready',
      json: undefined,
      data: { id: 'sandbox-id' },
      expected: undefined,
    },
    {
      name: 'createArtifactUploadSessionAsync',
      call: (api: SandboxWorkerApi) =>
        api.createArtifactUploadSessionAsync({ name: 'Crash log', filename: 'crash.log', size: 5 }),
      route: 'artifact-upload-sessions',
      headers: { 'Idempotency-Key': expect.any(String) },
      json: { name: 'Crash log', filename: 'crash.log', size: 5 },
      data: {
        artifact: { id: ARTIFACT_ID },
        uploadSession: { url: 'https://uploads.expo.test/a', headers: { 'If-None-Match': '*' } },
      },
      expected: {
        artifact: { id: ARTIFACT_ID },
        uploadSession: { url: 'https://uploads.expo.test/a', headers: { 'If-None-Match': '*' } },
      },
    },
    {
      name: 'finalizeArtifactAsync',
      call: (api: SandboxWorkerApi) => api.finalizeArtifactAsync(ARTIFACT_ID),
      route: `artifacts/${ARTIFACT_ID}/finalize`,
      json: undefined,
      data: { id: ARTIFACT_ID, downloadUrl: 'https://downloads.expo.test/a' },
      expected: 'https://downloads.expo.test/a',
    },
  ])(
    '$name calls POST /v2/sandbox-worker/$route with the sandbox worker token header',
    async ({ call, route, headers, json, data, expected }) => {
      jest.mocked(turtleFetch).mockResolvedValueOnce(jsonResponse({ data }));

      await expect(call(new SandboxWorkerApi(BASE_URL, TOKEN))).resolves.toEqual(expected);

      const [url, method, options] = jest.mocked(turtleFetch).mock.calls[0];
      expect(url).toBe(`https://api.expo.test/v2/sandbox-worker/${route}`);
      expect(method).toBe('POST');
      expect(options.headers).toEqual({ ...headers, 'expo-sandbox-worker-token': TOKEN });
      expect(options.json).toEqual(json);
    }
  );

  it('sends a new idempotency key for each artifact upload session', async () => {
    jest.mocked(turtleFetch).mockImplementation(async () =>
      jsonResponse({
        data: {
          artifact: { id: ARTIFACT_ID },
          uploadSession: { url: 'https://uploads.expo.test/a', headers: {} },
        },
      })
    );
    const api = new SandboxWorkerApi(BASE_URL, TOKEN);

    await api.createArtifactUploadSessionAsync({ name: 'A', filename: 'a.log', size: 1 });
    await api.createArtifactUploadSessionAsync({ name: 'B', filename: 'b.log', size: 1 });

    const [first, second] = jest
      .mocked(turtleFetch)
      .mock.calls.map(
        ([, , options]) => (options.headers as Record<string, string>)['Idempotency-Key']
      );
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('escapes the artifact ID in the finalize route', async () => {
    jest
      .mocked(turtleFetch)
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'a', downloadUrl: 'https://d.test/a' } }));

    await new SandboxWorkerApi(BASE_URL, TOKEN).finalizeArtifactAsync('../ready');

    expect(jest.mocked(turtleFetch).mock.calls[0][0]).toBe(
      'https://api.expo.test/v2/sandbox-worker/artifacts/..%2Fready/finalize'
    );
  });
});
