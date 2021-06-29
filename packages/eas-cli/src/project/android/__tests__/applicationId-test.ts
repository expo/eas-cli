import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { promptAsync } from '../../../prompts';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationId,
} from '../applicationId';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));

const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
beforeAll(() => {
  console.warn = jest.fn();
  console.log = jest.fn();
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
  console.log = originalConsoleLog;
});

describe(getApplicationId, () => {
  describe('generic projects', () => {
    it('reads applicationId from build.gradle', () => {
      vol.fromJSON(
        {
          'android/app/build.gradle': `
            applicationId "com.expo.notdominik"
          `,
        },
        '/app'
      );

      const applicationId = getApplicationId('/app', {} as any);
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if build.gradle does not exist', () => {
      vol.fromJSON(
        {
          'android/gradle.properties': 'fake file',
        },
        '/app'
      );
      expect(() => {
        getApplicationId('/app', {} as any);
      }).toThrowError(/Could not read application id/);
    });

    it('throws an error if the project does not have applicationId defined in build.gradle', () => {
      vol.fromJSON(
        {
          'android/app/build.gradle': `fake build.gradle`,
        },
        '/app'
      );

      expect(() => {
        getApplicationId('/app', {} as any);
      }).toThrowError(/Could not read application id/);
    });
  });

  describe('managed projects', () => {
    it('reads applicationId (Android package) from app config', () => {
      const applicationId = getApplicationId('/app', {
        android: { package: 'com.expo.notdominik' },
      } as any);
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if Android package is not defined in app config', () => {
      expect(() => {
        getApplicationId('/app', {} as any);
      }).toThrowError(/Specify "android.package"/);
    });

    it('throws an error if Android package in app config is invalid', () => {
      expect(() => {
        getApplicationId('/app', { android: { package: '1com.expo.notdominik' } } as any);
      }).toThrowError(/Specify "android.package"/);
    });
  });
});

describe(ensureApplicationIdIsDefinedForManagedProjectAsync, () => {
  describe('managed project + android.package missing in app config', () => {
    it('throws an error if using app.config.js', async () => {
      vol.fromJSON(
        {
          'app.config.js': 'module.exports = { blah: {} };',
        },
        '/app'
      );
      await expect(
        ensureApplicationIdIsDefinedForManagedProjectAsync('/app', {} as any)
      ).rejects.toThrowError(/we can't update this file programatically/);
    });
    it('prompts for the Android package if using app.json', async () => {
      vol.fromJSON(
        {
          'app.json': '{ "expo": {} }',
        },
        '/app'
      );

      asMock(promptAsync).mockImplementationOnce(() => ({
        packageName: 'com.expo.notdominik',
      }));

      await expect(
        ensureApplicationIdIsDefinedForManagedProjectAsync('/app', {} as any)
      ).resolves.toBe('com.expo.notdominik');
      expect(promptAsync).toHaveBeenCalled();
    });
    it('puts the Android package in app.json', async () => {
      vol.fromJSON(
        {
          'app.json': '{ "expo": {} }',
        },
        '/app'
      );

      asMock(promptAsync).mockImplementationOnce(() => ({
        packageName: 'com.expo.notdominik',
      }));

      await expect(
        ensureApplicationIdIsDefinedForManagedProjectAsync('/app', {} as any)
      ).resolves.toBe('com.expo.notdominik');
      expect(JSON.parse(fs.readFileSync('/app/app.json', 'utf-8'))).toMatchObject({
        expo: { android: { package: 'com.expo.notdominik' } },
      });
    });
  });
});
