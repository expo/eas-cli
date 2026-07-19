import fs from 'fs';
import http from 'http';
import path from 'path';

import { ImageNonPngError, ImageTransparencyError, ensurePNGIsNotTransparentAsync } from '../image';

const fixturesPath = path.join(__dirname, 'fixtures');
const transparentPngPath = path.join(fixturesPath, 'icon-alpha.png');
const nonTransparentPngPath = path.join(fixturesPath, 'icon-no-alpha.png');
const jpgPath = path.join(fixturesPath, 'icon.jpg');

describe(ensurePNGIsNotTransparentAsync, () => {
  describe('local paths', () => {
    it('throws an error for non-PNG files', async () => {
      await expect(ensurePNGIsNotTransparentAsync(jpgPath)).rejects.toThrowError(ImageNonPngError);
    });

    it('throws an error for transparent PNGs', async () => {
      await expect(ensurePNGIsNotTransparentAsync(transparentPngPath)).rejects.toThrowError(
        ImageTransparencyError
      );
    });

    it('does not throw for non transparent PNGs', async () => {
      await expect(ensurePNGIsNotTransparentAsync(nonTransparentPngPath)).resolves.not.toThrow();
    });
  });

  describe('remote URLs', () => {
    let server: http.Server;
    let transparentPngURL: string;

    beforeAll(async () => {
      server = http.createServer((_request, response) => {
        response.setHeader('Content-Type', 'image/png');
        fs.createReadStream(transparentPngPath).pipe(response);
      });
      await new Promise<void>((res, rej) => {
        const onError = (error: Error): void => rej(error);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError);
          res();
        });
      });

      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to determine test server address');
      }
      transparentPngURL = `http://127.0.0.1:${address.port}/icon-alpha.png`;
    });

    afterAll(async () => {
      await new Promise<void>(res => {
        server.close(() => {
          res();
        });
      });
    });

    it('works with remote URLs', async () => {
      await expect(ensurePNGIsNotTransparentAsync(transparentPngURL)).rejects.toThrowError(
        ImageTransparencyError
      );
    });
  });
});
