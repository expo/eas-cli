import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { promptAsync } from '../../../prompts';
import { resolveVcsClient } from '../../../vcs';
import { resolveGradleBuildContextAsync } from '../gradle';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));

const vcsClient = resolveVcsClient();

beforeEach(async () => {
  vol.reset();
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.mkdirp(os.tmpdir());

  jest.mocked(promptAsync).mockReset();
});

describe(resolveGradleBuildContextAsync, () => {
  describe('bare projects', () => {
    it('resolves to default config (no flavor)', async () => {
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

      const gradleContext = await resolveGradleBuildContextAsync('/app', {} as any, vcsClient);
      expect(gradleContext).toEqual({ moduleName: 'app' });
    });
    it('resolves to flavor', async () => {
      vol.fromJSON(
        {
          'android/app/build.gradle': `
          android {
            defaultConfig {
              applicationId "com.expo.notdominik"
            }
            productFlavors {
              abc {
                applicationId "efwaf.eafawefwa.wefwf"
              }
            }
          }
          `,
          'android/app/src/main/AndroidManifest.xml': 'fake',
        },
        '/app'
      );

      const gradleContext = await resolveGradleBuildContextAsync(
        '/app',
        {
          gradleCommand: ':app:buildAbcRelease',
        } as any,
        vcsClient
      );
      expect(gradleContext).toEqual({ moduleName: 'app', flavor: 'abc' });
    });

    it('returns undefined if build.gradle does not exist', async () => {
      vol.fromJSON(
        {
          'android/gradle.properties': 'fake file',
          'android/app/src/main/AndroidManifest.xml': 'fake',
        },
        '/app'
      );
      const gradleContext = await resolveGradleBuildContextAsync(
        '/app',
        {
          gradleCommand: ':app:buildAbcRelease',
        } as any,
        vcsClient
      );
      expect(gradleContext).toEqual(undefined);
    });
    it('returns undefined if flavor does not exist', async () => {
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

      const gradleContext = await resolveGradleBuildContextAsync(
        '/app',
        {
          gradleCommand: ':app:buildAbcRelease',
        } as any,
        vcsClient
      );
      expect(gradleContext).toEqual(undefined);
    });
  });

  describe('managed projects', () => {
    it('resolves to { moduleName: app } for managed projects', async () => {
      const gradleContext = await resolveGradleBuildContextAsync('/app', {} as any, {} as any);
      expect(gradleContext).toEqual({ moduleName: 'app' });
    });
  });
});
