import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';

import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants.js';
import { promptAsync } from '../../../prompts.js';
import {
  ensureBundleIdentifierIsDefinedForManagedProjectAsync,
  getBundleIdentifierAsync,
  isWildcardBundleIdentifier,
} from '../bundleIdentifier.js';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));

beforeEach(async () => {
  vol.reset();

  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.mkdirp(os.tmpdir());

  jest.mocked(promptAsync).mockReset();
});

const originalFs = jest.requireActual('fs') as typeof fs;

describe(getBundleIdentifierAsync, () => {
  describe('bare projects', () => {
    it('reads bundle identifier from project.', async () => {
      vol.fromJSON(
        {
          'ios/myproject.xcodeproj/project.pbxproj': await originalFs.promises.readFile(
            path.join(__dirname, './fixtures/pbxproj/project.pbxproj'),
            'utf-8'
          ),
        },
        '/app'
      );

      const bundleIdentifier = await getBundleIdentifierAsync('/app', {} as any);
      expect(bundleIdentifier).toBe('org.name.testproject');
    });

    it('throws an error if the pbxproj is not configured with bundle id', async () => {
      vol.fromJSON(
        {
          'ios/myproject.xcodeproj/project.pbxproj': await originalFs.promises.readFile(
            path.join(__dirname, './fixtures/pbxproj/project-without-bundleid.pbxproj'),
            'utf-8'
          ),
        },
        '/app'
      );

      await expect(getBundleIdentifierAsync('/app', {} as any)).rejects.toThrowError(
        /Could not read bundle identifier/
      );
    });
  });

  describe('managed projects', () => {
    it('reads bundleIdentifier from app config', async () => {
      const applicationId = await getBundleIdentifierAsync('/app', {
        ios: { bundleIdentifier: 'com.expo.notdominik' },
      } as any);
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if bundleIdentifier is not defined in app config', async () => {
      await expect(getBundleIdentifierAsync('/app', {} as any)).rejects.toThrowError(
        /Specify "ios.bundleIdentifier"/
      );
    });

    it('throws an error if bundleIdentifier in app config is invalid', async () => {
      await expect(
        getBundleIdentifierAsync('/app', { ios: { bundleIdentifier: '' } } as any)
      ).rejects.toThrowError(/Specify "ios.bundleIdentifier"/);
    });
  });
});

describe(ensureBundleIdentifierIsDefinedForManagedProjectAsync, () => {
  describe('managed project + ios.bundleIdentifier missing in app config', () => {
    it('throws an error if using app.config.js', async () => {
      vol.fromJSON(
        {
          'app.config.js': 'module.exports = { blah: {} };',
        },
        '/app'
      );
      await expect(
        ensureBundleIdentifierIsDefinedForManagedProjectAsync('/app', {} as any)
      ).rejects.toThrowError(/we can't update this file programmatically/);
    });
    it('prompts for the bundle identifier if using app.json', async () => {
      vol.fromJSON(
        {
          'app.json': '{ "expo": {} }',
        },
        '/app'
      );

      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
        bundleIdentifier: 'com.expo.notdominik',
      }));

      await expect(
        ensureBundleIdentifierIsDefinedForManagedProjectAsync('/app', {} as any)
      ).resolves.toBe('com.expo.notdominik');
      expect(promptAsync).toHaveBeenCalled();
    });
    it('puts the bundle identifier in app.json', async () => {
      vol.fromJSON(
        {
          'app.json': '{ "expo": {} }',
        },
        '/app'
      );

      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
        bundleIdentifier: 'com.expo.notdominik',
      }));

      await expect(
        ensureBundleIdentifierIsDefinedForManagedProjectAsync('/app', {} as any)
      ).resolves.toBe('com.expo.notdominik');
      const appJson = JSON.parse(await fs.readFile('/app/app.json', 'utf-8'));
      expect(appJson).toMatchObject({
        expo: { ios: { bundleIdentifier: 'com.expo.notdominik' } },
      });
    });
  });
});

describe(isWildcardBundleIdentifier, () => {
  it('classifies wildcard bundle identifiers correctly', async () => {
    expect(isWildcardBundleIdentifier('doge.doge.*')).toBe(true);
    expect(isWildcardBundleIdentifier('doge*')).toBe(true);

    expect(isWildcardBundleIdentifier('*')).toBe(false);
    expect(isWildcardBundleIdentifier('*.doge')).toBe(false);
    expect(isWildcardBundleIdentifier('doge')).toBe(false);
    expect(isWildcardBundleIdentifier('doge.doge.doge')).toBe(false);
  });
});
