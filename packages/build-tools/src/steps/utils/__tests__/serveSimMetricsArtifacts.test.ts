import { bunyan } from '@expo/logger';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { uploadServeSimMetricsFileAsync } from '../serveSimMetricsArtifacts';

jest.mock('../deviceRunSessionArtifacts');
jest.mock('../../../sentry');

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

async function readStreamAsync(stream: NodeJS.ReadableStream): Promise<string> {
  let out = '';
  for await (const chunk of stream as Readable) {
    out += chunk.toString();
  }
  return out;
}

const ctx = {} as CustomBuildContext;
const NDJSON = '{"t":1000,"cpuPct":1,"memBytes":2}\n';

let workDir: string;
let filePath: string;

beforeEach(async () => {
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockReset();
  workDir = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-metrics-art-test-'));
  filePath = path.join(workDir, 'AAAA.ndjson');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe(uploadServeSimMetricsFileAsync, () => {
  it('uploads the file as a metrics.ndjson artifact keyed by udid', async () => {
    await writeFile(filePath, NDJSON);
    let uploaded = '';
    jest
      .mocked(uploadDeviceRunSessionArtifactAsync)
      .mockImplementation(async (_ctx, { stream }) => {
        uploaded = await readStreamAsync(stream);
      });

    await uploadServeSimMetricsFileAsync(ctx, {
      deviceRunSessionId: 'session-id',
      udid: 'AAAA',
      filePath,
      logger: createLoggerMock(),
    });

    expect(uploaded).toBe(NDJSON);
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        deviceRunSessionId: 'session-id',
        artifactId: 'metrics-AAAA',
        filename: 'metrics.ndjson',
        size: Buffer.byteLength(NDJSON),
      })
    );
  });

  it('skips the upload when the file is missing', async () => {
    await uploadServeSimMetricsFileAsync(ctx, {
      deviceRunSessionId: 'session-id',
      udid: 'AAAA',
      filePath,
      logger: createLoggerMock(),
    });
    expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
  });

  it('skips the upload when the file is empty', async () => {
    await writeFile(filePath, '');
    await uploadServeSimMetricsFileAsync(ctx, {
      deviceRunSessionId: 'session-id',
      udid: 'AAAA',
      filePath,
      logger: createLoggerMock(),
    });
    expect(uploadDeviceRunSessionArtifactAsync).not.toHaveBeenCalled();
  });

  it('swallows an upload failure (best-effort)', async () => {
    await writeFile(filePath, NDJSON);
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('R2 down'));
    await expect(
      uploadServeSimMetricsFileAsync(ctx, {
        deviceRunSessionId: 'session-id',
        udid: 'AAAA',
        filePath,
        logger: createLoggerMock(),
      })
    ).resolves.toBeUndefined();
  });
});
