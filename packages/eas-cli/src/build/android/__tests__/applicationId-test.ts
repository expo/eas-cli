import { Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { asMock } from '../../../__tests__/utils';
import { promptAsync } from '../../../prompts';
import { getApplicationId, getOrConfigureApplicationIdAsync } from '../applicationId';

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

      const applicationId = getApplicationId({
        projectDir: '/app',
        exp: {} as any,
        workflow: Workflow.GENERIC,
      });
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if build.gradle does not exist', () => {
      expect(() => {
        getApplicationId({
          projectDir: '/app',
          exp: {} as any,
          workflow: Workflow.GENERIC,
        });
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
        getApplicationId({
          projectDir: '/app',
          exp: {} as any,
          workflow: Workflow.GENERIC,
        });
      }).toThrowError(/Could not read application id/);
    });
  });

  describe('managed projects', () => {
    it('reads applicationId (Android package) from app config', () => {
      const applicationId = getApplicationId({
        projectDir: '/app',
        exp: { android: { package: 'com.expo.notdominik' } } as any,
        workflow: Workflow.MANAGED,
      });
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if Android package is not defined in app config', () => {
      expect(() => {
        getApplicationId({
          projectDir: '/app',
          exp: {} as any,
          workflow: Workflow.MANAGED,
        });
      }).toThrowError(/Specify "android.package"/);
    });

    it('throws an error if Android package in app config is invalid', () => {
      expect(() => {
        getApplicationId({
          projectDir: '/app',
          exp: { android: { package: '1com.expo.notdominik' } } as any,
          workflow: Workflow.MANAGED,
        });
      }).toThrowError(/Specify "android.package"/);
    });
  });
});

describe(getOrConfigureApplicationIdAsync, () => {
  describe('managed project + android.package missing in app config', () => {
    it('throws an error if using app.config.js', async () => {
      vol.fromJSON(
        {
          'app.config.js': 'module.exports = { blah: {} };',
        },
        '/app'
      );
      await expect(
        getOrConfigureApplicationIdAsync({
          projectDir: '/app',
          exp: {} as any,
          workflow: Workflow.MANAGED,
        })
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
        getOrConfigureApplicationIdAsync({
          projectDir: '/app',
          exp: {} as any,
          workflow: Workflow.MANAGED,
        })
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
        getOrConfigureApplicationIdAsync({
          projectDir: '/app',
          exp: {} as any,
          workflow: Workflow.MANAGED,
        })
      ).resolves.toBe('com.expo.notdominik');
      expect(JSON.parse(fs.readFileSync('/app/app.json', 'utf-8'))).toMatchObject({
        expo: { android: { package: 'com.expo.notdominik' } },
      });
    });
  });
});
