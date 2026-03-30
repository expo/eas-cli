import fs from 'fs-extra';
import nock from 'nock';
import os from 'os';
import path from 'path';

import { createMockLogger } from '../../__tests__/utils/logger';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

describe('precompiledModules integration', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('merges the extracted debug and release xcframework trees', async () => {
    const homeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'precompiled-modules-home-'));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDirectory;

    try {
      const fixturesDirectory = path.join(__dirname, 'fixtures', 'precompiledModules');
      const debugArchive = await fs.readFile(
        path.join(fixturesDirectory, 'xcframeworks-Debug.zip')
      );
      const releaseArchive = await fs.readFile(
        path.join(fixturesDirectory, 'xcframeworks-Release.zip')
      );

      nock('https://fixtures.expo.test')
        .get('/xcframeworks-Debug.zip')
        .reply(200, debugArchive, { 'Content-Type': 'application/zip' })
        .get('/xcframeworks-Release.zip')
        .reply(200, releaseArchive, { 'Content-Type': 'application/zip' });

      jest.resetModules();
      jest.doMock('os', () => ({
        ...jest.requireActual('os'),
        homedir: () => homeDirectory,
      }));
      const {
        PRECOMPILED_MODULES_PATH,
        startPreparingPrecompiledDependencies,
        waitForPrecompiledModulesPreparationAsync,
      } = await import('../precompiledModules');

      startPreparingPrecompiledDependencies(
        {
          logger: createMockLogger(),
          env: {},
        } as any,
        [
          'https://fixtures.expo.test/xcframeworks-Debug.zip',
          'https://fixtures.expo.test/xcframeworks-Release.zip',
        ]
      );
      await waitForPrecompiledModulesPreparationAsync();

      expect(PRECOMPILED_MODULES_PATH).toBe(
        path.join(homeDirectory, '.expo', 'precompiled-modules')
      );

      await expect(
        fs.readFile(
          path.join(
            PRECOMPILED_MODULES_PATH,
            'expo-modules-core/output/debug/xcframeworks/ExpoModulesCore.tar.gz'
          ),
          'utf8'
        )
      ).resolves.toBe('debug expo-modules-core fixture\n');
      await expect(
        fs.readFile(
          path.join(
            PRECOMPILED_MODULES_PATH,
            'expo-modules-core/output/release/xcframeworks/ExpoModulesCore.tar.gz'
          ),
          'utf8'
        )
      ).resolves.toBe('release expo-modules-core fixture\n');
      await expect(
        fs.readFile(
          path.join(
            PRECOMPILED_MODULES_PATH,
            'expo-camera/output/debug/xcframeworks/ExpoCamera.tar.gz'
          ),
          'utf8'
        )
      ).resolves.toBe('debug expo-camera fixture\n');
      await expect(
        fs.readFile(
          path.join(
            PRECOMPILED_MODULES_PATH,
            'expo-application/output/release/xcframeworks/EXApplication.tar.gz'
          ),
          'utf8'
        )
      ).resolves.toBe('release expo-application fixture\n');
    } finally {
      jest.dontMock('os');
      jest.resetModules();
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      await fs.remove(homeDirectory);
    }
  });
});
