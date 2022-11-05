import express from 'express';
import http from 'http';
import path from 'path';

import { ImageNonPngError, ImageTransparencyError, ensurePNGIsNotTransparentAsync } from '../image';

const TEST_SERVER_PORT = 2137;

const fixturesPath = path.join(__dirname, 'fixtures');
const transparentPngPath = path.join(fixturesPath, 'icon-alpha.png');
const nonTransparentPngPath = path.join(fixturesPath, 'icon-no-alpha.png');
const jpgPath = path.join(fixturesPath, 'icon.jpg');
const nonTransparentPngURL = `http://127.0.0.1:${TEST_SERVER_PORT}/icon-alpha.png`;

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

    beforeAll(async () => {
      await new Promise<void>(res => {
        const app = express();
        app.use(express.static(fixturesPath));
        server = app.listen(TEST_SERVER_PORT, () => {
          res();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>(res => {
        server.close(() => {
          res();
        });
      });
    });

    it('works with remote URLs', async () => {
      await expect(ensurePNGIsNotTransparentAsync(nonTransparentPngURL)).rejects.toThrowError(
        ImageTransparencyError
      );
    });
  });
});
