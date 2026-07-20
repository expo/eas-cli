import { randomBytes } from 'crypto';
import fetch, { RequestInit, Response } from 'node-fetch';
import { Readable } from 'stream';

import { type SignedUrl, uploadWithSignedUrl } from '../uploadWithSignedUrl';

jest.mock('node-fetch');

class ErrorWithCode extends Error {
  protected readonly _code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    if (code) {
      this._code = code;
    }
  }

  public get code(): string | undefined {
    return this._code;
  }
}

class DNSError extends ErrorWithCode {
  protected readonly _code: 'ENOTFOUND' | 'EAI_AGAIN' = 'ENOTFOUND';
}

const TEST_BUCKET = 'turtle-v2-test';

function createSignedUrl(key: string, contentType: string): SignedUrl {
  return {
    url: `https://storage.googleapis.com/${TEST_BUCKET}/${key}?signature=test`,
    headers: { 'content-type': contentType },
  };
}

describe('signed URL uploader', () => {
  describe('uploadWithSignedUrl', () => {
    it('should throw an error if upload fails', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: false,
        status: 500,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      fetchMock.mockImplementation(async () => res);
      await expect(
        uploadWithSignedUrl({
          signedUrl,
          srcGeneratorAsync: async () => Readable.from('image'),
          retryIntervalMs: 0,
        })
      ).rejects.toThrow();
    });

    it('should return stripped URL if successful', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      fetchMock.mockImplementation(async () => res);
      const result = await uploadWithSignedUrl({
        signedUrl,
        srcGeneratorAsync: async () => Readable.from('image'),
        retryIntervalMs: 0,
      });
      expect(result).toEqual('https://storage.googleapis.com/turtle-v2-test/cat.jpg');
    });

    it('should retry upload on DNS error up to 2 times', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      fetchMock
        .mockImplementationOnce(async () => {
          throw new DNSError('failed once');
        })
        .mockImplementationOnce(async () => {
          throw new DNSError('failed twice', 'EAI_AGAIN');
        })
        .mockImplementation(async () => res);
      const result = await uploadWithSignedUrl({
        signedUrl,
        srcGeneratorAsync: async () => Readable.from('image'),
        retryIntervalMs: 0,
      });
      expect(result).toEqual('https://storage.googleapis.com/turtle-v2-test/cat.jpg');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should retry upload on retriable status codes error up to 2 times', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      fetchMock
        .mockImplementationOnce(async () => {
          return {
            ok: false,
            status: 503,
          } as Response;
        })
        .mockImplementationOnce(async () => {
          return {
            ok: false,
            status: 408,
          } as Response;
        })
        .mockImplementation(async () => res);
      const result = await uploadWithSignedUrl({
        signedUrl,
        srcGeneratorAsync: async () => Readable.from('image'),
        retryIntervalMs: 0,
      });
      expect(result).toEqual('https://storage.googleapis.com/turtle-v2-test/cat.jpg');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should retry upload on retriable status codes and DNS errors error up to 2 times', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      fetchMock
        .mockImplementationOnce(async () => {
          return {
            ok: false,
            status: 503,
          } as Response;
        })
        .mockImplementationOnce(async () => {
          throw new DNSError('failed once');
        })
        .mockImplementation(async () => res);
      const result = await uploadWithSignedUrl({
        signedUrl,
        srcGeneratorAsync: async () => Readable.from('image'),
        retryIntervalMs: 0,
      });
      expect(result).toEqual('https://storage.googleapis.com/turtle-v2-test/cat.jpg');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should not retry upload on DNS error more than 2 times', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      const lastDNSError = new DNSError('failed thrice');
      fetchMock
        .mockImplementationOnce(async () => {
          throw new DNSError('failed once');
        })
        .mockImplementationOnce(async () => {
          throw new DNSError('failed twice', 'EAI_AGAIN');
        })
        .mockImplementationOnce(async () => {
          throw lastDNSError;
        })
        .mockImplementation(async () => res);
      await expect(
        uploadWithSignedUrl({
          signedUrl,
          srcGeneratorAsync: async () => Readable.from('image'),
          retryIntervalMs: 0,
        })
      ).rejects.toThrow(lastDNSError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should not retry upload on retriable status code more than 2 times', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      fetchMock
        .mockImplementationOnce(async () => {
          return {
            ok: false,
            status: 503,
          } as Response;
        })
        .mockImplementationOnce(async () => {
          return {
            ok: false,
            status: 408,
          } as Response;
        })
        .mockImplementationOnce(async () => {
          return {
            ok: false,
            status: 504,
          } as Response;
        })
        .mockImplementation(async () => res);
      await expect(
        uploadWithSignedUrl({
          signedUrl,
          srcGeneratorAsync: async () => Readable.from('image'),
          retryIntervalMs: 0,
        })
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should not retry upload on other error codes', async () => {
      const fetchMock = jest.mocked(fetch);
      const res = {
        ok: true,
        status: 200,
      } as Response;

      const key = 'cat.jpg';

      const signedUrl = createSignedUrl(key, 'image/jpeg');

      const nonDNSError = new ErrorWithCode('failed once', 'A_DIFFERENT_CODE');
      fetchMock
        .mockImplementationOnce(async () => {
          throw nonDNSError;
        })
        .mockImplementation(async () => res);
      await expect(
        uploadWithSignedUrl({
          signedUrl,
          srcGeneratorAsync: async () => Readable.from('image'),
          retryIntervalMs: 0,
        })
      ).rejects.toThrow(nonDNSError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries upload with full stream', async () => {
      const fetchMock = jest.mocked(fetch);
      const receivedBodies: Buffer[] = [];
      const recordBody = async (request: RequestInit | undefined): Promise<void> => {
        let body = Buffer.from([]);
        for await (const chunk of request!.body as Readable) {
          body = Buffer.concat([body, chunk]);
        }
        receivedBodies.push(body);
      };
      fetchMock
        .mockImplementationOnce(async (_path, request) => {
          await recordBody(request);
          return {
            ok: false,
            status: 503,
          } as Response;
        })
        .mockImplementationOnce(async (_path, request) => {
          await recordBody(request);
          throw new DNSError('failed once');
        })
        .mockImplementation(async (_path, request) => {
          await recordBody(request);
          return {
            ok: true,
            status: 201,
          } as Response;
        });

      const signedUrl = createSignedUrl('text.txt', 'text/plain');

      const bufferToUpload = randomBytes(16);

      const result = await uploadWithSignedUrl({
        signedUrl,
        srcGeneratorAsync: async () => Readable.from(bufferToUpload),
        retryIntervalMs: 0,
      });
      expect(result).toEqual('https://storage.googleapis.com/turtle-v2-test/text.txt');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(receivedBodies.length).toBe(3);
      for (const body of receivedBodies) {
        // Here we're testing that each body received in every retry is the same.
        // If we passed the same body instance to each of the retries
        // each retry would consume a chunk of the same stream,
        // causing the uploaded file to be corrupted (missing first bytes).
        expect(body).toStrictEqual(bufferToUpload);
      }
    });
  });
});
