import { type bunyan } from '@expo/logger';

import * as signedUrlUploader from '../../storage/uploadWithSignedUrl';
import RemoteLoggerStream from '../RemoteLoggerStream';

describe(RemoteLoggerStream, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads an exact snapshot size for an uncompressed signed URL', async () => {
    const contentLengths: (number | undefined)[] = [];
    jest
      .spyOn(signedUrlUploader, 'uploadWithSignedUrl')
      .mockImplementation(async ({ contentLength }) => {
        contentLengths.push(contentLength);
        return 'https://uploads.expo.test/logs.ndjson';
      });
    const logger = createLogger();
    const stream = new RemoteLoggerStream({
      logger,
      uploadMethod: {
        signedUrl: {
          url: 'https://uploads.expo.test/logs.ndjson',
          headers: { 'Content-Type': 'application/x-ndjson' },
        },
      },
      options: { uploadIntervalMs: 60_000 },
    });

    await stream.init();
    const record = { message: 'Tapped 🧪' };
    stream.write(record);
    await stream.cleanUp();

    expect(logger.error).not.toHaveBeenCalled();
    const expectedBody = `${JSON.stringify(record)}\n`;
    expect(contentLengths).toEqual([0, Buffer.byteLength(expectedBody)]);
  });
});

function createLogger(): bunyan {
  return {
    error: jest.fn(),
    info: jest.fn(),
  } as unknown as bunyan;
}
