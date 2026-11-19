import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import fetch, { RequestError, Response } from '../../fetch';
import {
  DeviceRunSessionAnnotationUploadError,
  appendAndUploadDeviceRunSessionAnnotationAsync,
  createDeviceRunSessionAnnotation,
  getDeviceRunSessionAnnotationDirectory,
} from '../annotations';

jest.mock('../../fetch', () => ({
  __esModule: true,
  ...jest.requireActual('../../fetch'),
  default: jest.fn(),
}));

const mockFetch = jest.mocked(fetch);
const deviceRunSessionId = 'device-run-session-id';
const uploadSession = {
  downloadUrl: 'https://example.test/annotations',
  uploadUrl: 'https://storage.test/annotations',
  uploadHeaders: { 'x-goog-content-length-range': '0,5242880' },
};

describe('simulator annotations', () => {
  let dataDirectory: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-annotations-'));
  });

  afterEach(async () => {
    await fs.remove(dataDirectory);
  });

  it('seeds a missing spool, appends NDJSON, and uploads the complete file', async () => {
    mockFetch
      .mockRejectedValueOnce(new RequestError('not found', new Response('', { status: 404 })))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const annotation = createDeviceRunSessionAnnotation({
      annotationId: 'annotation-id',
      category: 'intent',
      message: '  Opening settings next.  ',
      timestamp: new Date('2026-08-11T12:00:00.000Z'),
    });

    const result = await appendAndUploadDeviceRunSessionAnnotationAsync({
      annotation,
      dataDirectory,
      deviceRunSessionId,
      uploadSession,
    });

    const expectedContents = `${JSON.stringify({
      v: 1,
      annotationId: 'annotation-id',
      ts: '2026-08-11T12:00:00.000Z',
      category: 'intent',
      message: 'Opening settings next.',
    })}\n`;
    await expect(fs.readFile(result.filePath, 'utf8')).resolves.toBe(expectedContents);
    expect(result.fileSizeBytes).toBe(Buffer.byteLength(expectedContents));
    expect(mockFetch).toHaveBeenNthCalledWith(1, uploadSession.downloadUrl);
    expect(mockFetch).toHaveBeenNthCalledWith(2, uploadSession.uploadUrl, {
      method: 'PUT',
      headers: uploadSession.uploadHeaders,
      body: Buffer.from(expectedContents),
    });
  });

  it('keeps appending to the local spool and replaces the remote object with all annotations', async () => {
    mockFetch
      .mockRejectedValueOnce(new RequestError('not found', new Response('', { status: 404 })))
      .mockResolvedValue(new Response('', { status: 200 }));
    const firstAnnotation = createDeviceRunSessionAnnotation({
      annotationId: 'first',
      category: 'observation',
      message: 'The settings screen is open.',
      timestamp: new Date('2026-08-11T12:00:00.000Z'),
    });
    const secondAnnotation = createDeviceRunSessionAnnotation({
      annotationId: 'second',
      category: 'decision',
      message: 'Enabling dark mode.',
      timestamp: new Date('2026-08-11T12:00:01.000Z'),
    });

    await appendAndUploadDeviceRunSessionAnnotationAsync({
      annotation: firstAnnotation,
      dataDirectory,
      deviceRunSessionId,
      uploadSession,
    });
    mockFetch.mockClear();
    await appendAndUploadDeviceRunSessionAnnotationAsync({
      annotation: secondAnnotation,
      dataDirectory,
      deviceRunSessionId,
      uploadSession,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const uploaded = mockFetch.mock.calls[0][1]?.body;
    expect(Buffer.isBuffer(uploaded) ? uploaded.toString('utf8') : null).toBe(
      `${JSON.stringify(firstAnnotation)}\n${JSON.stringify(secondAnnotation)}\n`
    );
  });

  it('downloads an existing remote log when the local spool is missing', async () => {
    const existingAnnotation = createDeviceRunSessionAnnotation({
      annotationId: 'remote',
      category: 'commentary',
      message: 'Existing commentary.',
      timestamp: new Date('2026-08-11T12:00:00.000Z'),
    });
    const nextAnnotation = createDeviceRunSessionAnnotation({
      annotationId: 'local',
      category: 'result',
      message: 'The change worked.',
      timestamp: new Date('2026-08-11T12:00:01.000Z'),
    });
    mockFetch
      .mockResolvedValueOnce(
        new Response(`${JSON.stringify(existingAnnotation)}\n`, { status: 200 })
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    await appendAndUploadDeviceRunSessionAnnotationAsync({
      annotation: nextAnnotation,
      dataDirectory,
      deviceRunSessionId,
      uploadSession,
    });

    const uploaded = mockFetch.mock.calls[1][1]?.body;
    expect(Buffer.isBuffer(uploaded) ? uploaded.toString('utf8') : null).toBe(
      `${JSON.stringify(existingAnnotation)}\n${JSON.stringify(nextAnnotation)}\n`
    );
  });

  it('retains the appended spool when the upload fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new RequestError('not found', new Response('', { status: 404 })))
      .mockRejectedValueOnce(new Error('network unavailable'));
    const annotation = createDeviceRunSessionAnnotation({
      annotationId: 'pending',
      category: 'commentary',
      message: 'This should be retried.',
    });

    await expect(
      appendAndUploadDeviceRunSessionAnnotationAsync({
        annotation,
        dataDirectory,
        deviceRunSessionId,
        uploadSession,
      })
    ).rejects.toBeInstanceOf(DeviceRunSessionAnnotationUploadError);

    const filePath = path.join(
      getDeviceRunSessionAnnotationDirectory(dataDirectory, deviceRunSessionId),
      'annotations.ndjson'
    );
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(`${JSON.stringify(annotation)}\n`);
  });

  it('rejects empty and oversized commentary', () => {
    expect(() =>
      createDeviceRunSessionAnnotation({ category: 'commentary', message: '   ' })
    ).toThrow('must not be empty');
    expect(() =>
      createDeviceRunSessionAnnotation({ category: 'commentary', message: 'x'.repeat(2_001) })
    ).toThrow('must not exceed 2000 characters');
  });
});
