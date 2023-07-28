import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor, EasJsonUtils, errors } from '@expo/eas-json';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import Log from '../../log';
import { selectAsync } from '../../prompts';
import {
  clearHasPrintedDeprecationWarnings,
  getProfilesAsync,
  maybePrintBuildProfileDeprecationWarningsAsync,
} from '../profiles';

jest.mock('fs');
jest.mock('../../prompts');
jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');

  const EasJsonUtilsMock = {
    getBuildProfileAsync: jest.fn(),
    getBuildProfileNamesAsync: jest.fn(),
    getBuildProfileDeprecationWarningsAsync: jest.fn(() => []),
  };
  return {
    ...actual,
    EasJsonUtils: EasJsonUtilsMock,
  };
});

const getBuildProfileAsync = jest.spyOn(EasJsonUtils, 'getBuildProfileAsync');
const getBuildProfileNamesAsync = jest.spyOn(EasJsonUtils, 'getBuildProfileNamesAsync');
const getBuildProfileDeprecationWarningsAsync = jest.spyOn(
  EasJsonUtils,
  'getBuildProfileDeprecationWarningsAsync'
);
const newLineSpy = jest.spyOn(Log, 'newLine');
const warnSpy = jest.spyOn(Log, 'warn');
const projectDir = '/app';

describe(getProfilesAsync, () => {
  afterEach(() => {
    getBuildProfileAsync.mockReset();
    getBuildProfileNamesAsync.mockReset();
    jest.mocked(selectAsync).mockReset();
  });

  it('defaults to production profile', async () => {
    const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
    const readRawEasJsonMock = jest.spyOn(easJsonAccessor, 'readRawJsonAsync');
    readRawEasJsonMock.mockImplementation(async () => {
      return {};
    });
    const result = await getProfilesAsync({
      easJsonAccessor,
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      type: 'build',
      projectDir,
    });

    expect(result[0].profileName).toBe('production');
    expect(result[1].profileName).toBe('production');
    expect(getBuildProfileAsync).toBeCalledWith(easJsonAccessor, Platform.ANDROID, undefined);
    expect(getBuildProfileAsync).toBeCalledWith(easJsonAccessor, Platform.IOS, undefined);
  });

  it('throws an error if there are no profiles in eas.json', async () => {
    getBuildProfileAsync.mockImplementation(async () => {
      throw new errors.MissingProfileError();
    });
    getBuildProfileNamesAsync.mockImplementation(() => Promise.resolve([]));

    await expect(
      getProfilesAsync({
        easJsonAccessor: EasJsonAccessor.fromProjectPath('/fake'),
        platforms: [Platform.ANDROID],
        profileName: undefined,
        type: 'build',
        projectDir,
      })
    ).rejects.toThrowError(errors.MissingProfileError);
  });

  it('gets a specific profile', async () => {
    const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
    const readRawEasJsonMock = jest.spyOn(easJsonAccessor, 'readRawJsonAsync');
    readRawEasJsonMock.mockImplementation(async () => {
      return {};
    });
    const result = await getProfilesAsync({
      easJsonAccessor,
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: 'custom-profile',
      type: 'build',
      projectDir,
    });

    expect(result[0].profileName).toBe('custom-profile');
    expect(result[1].profileName).toBe('custom-profile');
    expect(getBuildProfileAsync).toBeCalledWith(
      easJsonAccessor,
      Platform.ANDROID,
      'custom-profile'
    );
    expect(getBuildProfileAsync).toBeCalledWith(easJsonAccessor, Platform.IOS, 'custom-profile');
  });

  describe('node version', () => {
    const nodeVersion = '14.17.1';

    it('is read from profile', async () => {
      const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
      getBuildProfileAsync.mockImplementation(async () => {
        return { node: nodeVersion } as BuildProfile<Platform.ANDROID>;
      });
      const result = await getProfilesAsync({
        easJsonAccessor,
        platforms: [Platform.ANDROID],
        profileName: 'custom-profile',
        type: 'build',
        projectDir,
      });

      expect(result[0].profile.node).toBe(nodeVersion);
    });

    describe('with .nvmrc', () => {
      beforeEach(async () => {
        vol.reset();
        await fs.mkdirp(os.tmpdir());

        vol.fromJSON({ '.nvmrc': nodeVersion }, projectDir);
      });

      it('is read from .nvmrc', async () => {
        const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
        getBuildProfileAsync.mockImplementation(async () => {
          return {} as BuildProfile<Platform.ANDROID>;
        });

        const result = await getProfilesAsync({
          easJsonAccessor,
          platforms: [Platform.ANDROID],
          profileName: 'custom-profile',
          type: 'build',
          projectDir,
        });

        expect(result[0].profile.node).toBe(nodeVersion);
      });
    });
  });

  it('throws validation error if eas.json is invalid', async () => {
    getBuildProfileAsync.mockImplementation(() => {
      throw new errors.InvalidEasJsonError('eas.json is not valid');
    });

    await expect(
      getProfilesAsync({
        easJsonAccessor: EasJsonAccessor.fromProjectPath('/fake'),
        platforms: [Platform.ANDROID, Platform.IOS],
        profileName: undefined,
        type: 'build',
        projectDir,
      })
    ).rejects.toThrowError(/eas.json is not valid/);
  });
});
describe(maybePrintBuildProfileDeprecationWarningsAsync, () => {
  afterEach(() => {
    clearHasPrintedDeprecationWarnings();
    newLineSpy.mockClear();
    warnSpy.mockClear();
  });
  const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
  const readRawEasJsonMock = jest.spyOn(easJsonAccessor, 'readRawJsonAsync');
  readRawEasJsonMock.mockImplementation(async () => {
    return {};
  });
  getBuildProfileAsync.mockImplementation(async () => {
    return {} as BuildProfile<Platform.ANDROID>;
  });

  describe('no deprecation warnings', () => {
    it('does not print any warnings', async () => {
      getBuildProfileDeprecationWarningsAsync.mockImplementation(async () => []);
      await maybePrintBuildProfileDeprecationWarningsAsync(
        easJsonAccessor,
        Platform.ANDROID,
        'production'
      );
      expect(newLineSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
  describe('one deprecation warning', () => {
    it('prints the warning', async () => {
      getBuildProfileDeprecationWarningsAsync.mockImplementation(async () => [
        {
          message: [
            'The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.',
          ],
          docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
        },
      ]);
      await maybePrintBuildProfileDeprecationWarningsAsync(
        easJsonAccessor,
        Platform.ANDROID,
        'production'
      );
      expect(newLineSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(3);
      const warnCalls = warnSpy.mock.calls;
      expect(warnCalls).toMatchSnapshot();
    });
  });
  describe('multiple deprecation warnings', () => {
    it('prints the warnings', async () => {
      getBuildProfileDeprecationWarningsAsync.mockImplementation(async () => [
        {
          message: [
            'The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.',
          ],
          docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
        },
        {
          message: [
            'The "build.production.cache.cacheDefaultPaths" field in eas.json is deprecated and will be removed in the future.',
          ],
          docsUrl: 'https://docs.expo.dev/build-reference/caching/#ios-dependencies',
        },
        {
          message: ['Other message'],
        },
      ]);
      await maybePrintBuildProfileDeprecationWarningsAsync(
        easJsonAccessor,
        Platform.ANDROID,
        'production'
      );
      expect(newLineSpy).toHaveBeenCalledTimes(4);
      expect(warnSpy).toHaveBeenCalledTimes(6);
      const warnCalls = warnSpy.mock.calls;
      expect(warnCalls).toMatchSnapshot();
    });
  });
});
