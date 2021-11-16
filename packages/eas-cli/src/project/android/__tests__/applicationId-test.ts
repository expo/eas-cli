import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { promptAsync } from '../../../prompts';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from '../applicationId';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));

beforeEach(async () => {
  vol.reset();

  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.mkdirp(os.tmpdir());

  asMock(promptAsync).mockReset();
});

describe(getApplicationIdAsync, () => {
  describe('bare projects', () => {
    it('reads applicationId from build.gradle', async () => {
      vol.fromJSON(
        {
          'android/app/build.gradle': `
          android {
            defaultConfig {
              applicationId "com.expo.notdominik"
            }
          }
          `,
          'android/app/src/main/AndroidManifest.xml': 'fake',
        },
        '/app'
      );

      const applicationId = await getApplicationIdAsync('/app', {} as any, { moduleName: 'app' });
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if build.gradle does not exist', async () => {
      vol.fromJSON(
        {
          'android/gradle.properties': 'fake file',
          'android/app/src/main/AndroidManifest.xml': 'fake',
        },
        '/app'
      );
      await expect(getApplicationIdAsync('/app', {} as any, undefined)).rejects.toThrowError(
        /Failed to find 'build.gradle' /
      );
    });

    it('throws an error if the project does not have applicationId defined in build.gradle', async () => {
      vol.fromJSON(
        {
          'android/app/build.gradle': `fake build.gradle`,
          'android/app/src/main/AndroidManifest.xml': 'fake',
        },
        '/app'
      );

      await expect(
        getApplicationIdAsync('/app', {} as any, { moduleName: 'app' })
      ).rejects.toThrowError(/Could not read applicationId/);
    });
  });

  describe('managed projects', () => {
    it('reads applicationId (Android package) from app config', async () => {
      const applicationId = await getApplicationIdAsync(
        '/app',
        {
          android: { package: 'com.expo.notdominik' },
        } as any,
        { moduleName: 'app' }
      );
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if Android package is not defined in app config', async () => {
      await expect(
        getApplicationIdAsync('/app', {} as any, { moduleName: 'app' })
      ).rejects.toThrowError(/Specify "android.package"/);
    });

    it('throws an error if Android package in app config is invalid', async () => {
      await expect(
        getApplicationIdAsync('/app', { android: { package: '1com.expo.notdominik' } } as any, {
          moduleName: 'app',
        })
      ).rejects.toThrowError(/Specify "android.package"/);
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
      ).rejects.toThrowError(/we can't update this file programmatically/);
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
      const appJson = JSON.parse(await fs.readFile('/app/app.json', 'utf-8'));
      expect(appJson).toMatchObject({
        expo: { android: { package: 'com.expo.notdominik' } },
      });
    });
  });
});
