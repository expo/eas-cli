import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';

import { asMock } from '../../../__tests__/utils';
import { promptAsync } from '../../../prompts';
import {
  ensureBundleIdentifierIsDefinedForManagedProjectAsync,
  getBundleIdentifier,
  isWildcardBundleIdentifier,
} from '../bundleIdentifier';

jest.mock('fs');
jest.mock('../../../prompts');

const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.warn = jest.fn();
});

beforeEach(() => {
  vol.reset();
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  fs.mkdirpSync(os.tmpdir());

  asMock(promptAsync).mockReset();
});

afterAll(() => {
  fs.removeSync(os.tmpdir());
  console.warn = originalConsoleWarn;
});

const originalFs = jest.requireActual('fs');

describe(getBundleIdentifier, () => {
  describe('generic projects', () => {
    it('reads bundle identifier from project.', () => {
      vol.fromJSON(
        {
          'ios/myproject.xcodeproj/project.pbxproj': originalFs.readFileSync(
            path.join(__dirname, './fixtures/pbxproj/project.pbxproj'),
            'utf-8'
          ),
        },
        '/app'
      );

      const bundleIdentifier = getBundleIdentifier('/app', {} as any);
      expect(bundleIdentifier).toBe('org.name.testproject');
    });

    it('throws an error if the pbxproj is not configured with bundle id', () => {
      vol.fromJSON(
        {
          'ios/myproject.xcodeproj/project.pbxproj': originalFs.readFileSync(
            path.join(__dirname, './fixtures/pbxproj/project-without-bundleid.pbxproj'),
            'utf-8'
          ),
        },
        '/app'
      );

      expect(() => {
        getBundleIdentifier('/app', {} as any);
      }).toThrowError(/Could not read bundle identifier/);
    });
  });

  describe('managed projects', () => {
    it('reads bundleIdentifier from app config', () => {
      const applicationId = getBundleIdentifier('/app', {
        ios: { bundleIdentifier: 'com.expo.notdominik' },
      } as any);
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if bundleIdentifier is not defined in app config', () => {
      expect(() => {
        getBundleIdentifier('/app', {} as any);
      }).toThrowError(/Specify "ios.bundleIdentifier"/);
    });

    it('throws an error if bundleIdentifier in app config is invalid', () => {
      expect(() => {
        getBundleIdentifier('/app', { ios: { bundleIdentifier: '' } } as any);
      }).toThrowError(/Specify "ios.bundleIdentifier"/);
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
      ).rejects.toThrowError(/we can't update this file programatically/);
    });
    it('prompts for the bundle identifier if using app.json', async () => {
      vol.fromJSON(
        {
          'app.json': '{ "expo": {} }',
        },
        '/app'
      );

      asMock(promptAsync).mockImplementationOnce(() => ({
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

      asMock(promptAsync).mockImplementationOnce(() => ({
        bundleIdentifier: 'com.expo.notdominik',
      }));

      await expect(
        ensureBundleIdentifierIsDefinedForManagedProjectAsync('/app', {} as any)
      ).resolves.toBe('com.expo.notdominik');
      expect(JSON.parse(fs.readFileSync('/app/app.json', 'utf-8'))).toMatchObject({
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
