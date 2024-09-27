import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester, jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { promptAsync } from '../../../prompts';
import { resolveVcsClient } from '../../../vcs';
import {
  ensureBundleIdentifierIsDefinedForManagedProjectAsync,
  getBundleIdentifierAsync,
  isWildcardBundleIdentifier,
} from '../bundleIdentifier';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../user/actions', () => ({ ensureLoggedInAsync: jest.fn(() => mockJester) }));

const vcsClient = resolveVcsClient();

beforeEach(async () => {
  vol.reset();

  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.mkdirp(os.tmpdir());

  jest.mocked(promptAsync).mockReset();
});

const originalFs = jest.requireActual('fs');

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

      const bundleIdentifier = await getBundleIdentifierAsync('/app', {} as any, vcsClient);
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

      await expect(getBundleIdentifierAsync('/app', {} as any, vcsClient)).rejects.toThrowError(
        /Could not read bundle identifier/
      );
    });
  });

  describe('managed projects', () => {
    it('reads bundleIdentifier from app config', async () => {
      const applicationId = await getBundleIdentifierAsync(
        '/app',
        {
          ios: { bundleIdentifier: 'com.expo.notdominik' },
        } as any,
        vcsClient
      );
      expect(applicationId).toBe('com.expo.notdominik');
    });

    it('throws an error if bundleIdentifier is not defined in app config', async () => {
      await expect(getBundleIdentifierAsync('/app', {} as any, vcsClient)).rejects.toThrowError(
        /Specify "ios.bundleIdentifier"/
      );
    });

    it('throws an error if bundleIdentifier in app config is invalid', async () => {
      await expect(
        getBundleIdentifierAsync('/app', { ios: { bundleIdentifier: '' } } as any, vcsClient)
      ).rejects.toThrowError(/Specify "ios.bundleIdentifier"/);
    });
  });
});

describe(ensureBundleIdentifierIsDefinedForManagedProjectAsync, () => {
  describe('managed project + ios.bundleIdentifier missing in app config', () => {
    it('throws an error if using app.config.js', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      vol.fromJSON(
        {
          'app.config.js': 'module.exports = { blah: {} };',
        },
        '/app'
      );
      await expect(
        ensureBundleIdentifierIsDefinedForManagedProjectAsync({
          graphqlClient,
          projectDir: '/app',
          projectId: '1234',
          exp: {} as any,
          vcsClient,
          nonInteractive: false,
        })
      ).rejects.toThrowError(/we can't update this file programmatically/);
    });
    it('throws an error in non-interactive mode', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      vol.fromJSON(
        {
          'app.json': '{ "blah": {} }',
        },
        '/app'
      );
      await expect(
        ensureBundleIdentifierIsDefinedForManagedProjectAsync({
          graphqlClient,
          projectDir: '/app',
          projectId: '1234',
          exp: {} as any,
          vcsClient,
          nonInteractive: true,
        })
      ).rejects.toThrowError(/non-interactive/);
    });
    it('prompts for the bundle identifier if using app.json', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester/testing-123',
        ownerAccount: jester.accounts[0],
      });

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
        ensureBundleIdentifierIsDefinedForManagedProjectAsync({
          graphqlClient,
          projectDir: '/app',
          projectId: '1234',
          exp: {} as any,
          vcsClient,
          nonInteractive: false,
        })
      ).resolves.toBe('com.expo.notdominik');
      expect(promptAsync).toHaveBeenCalled();
    });
    it('puts the bundle identifier in app.json', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      jest.mocked(AppQuery.byIdAsync).mockResolvedValue({
        id: '1234',
        slug: 'testing-123',
        name: 'testing-123',
        fullName: '@jester/testing-123',
        ownerAccount: jester.accounts[0],
      });

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
        ensureBundleIdentifierIsDefinedForManagedProjectAsync({
          graphqlClient,
          projectDir: '/app',
          projectId: '1234',
          exp: {} as any,
          vcsClient,
          nonInteractive: false,
        })
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
