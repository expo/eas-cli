import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor, EasJsonUtils, errors } from '@expo/eas-json';
import chalk from 'chalk';

import Log from '../../log';
import { selectAsync } from '../../prompts';
import {
  clearHasPrintedDeprecationWarnings,
  getProfilesAsync,
  maybePrintBuildProfileDeprecationWarningsAsync,
} from '../profiles';

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

  describe('no deprecation warnings', () => {
    it('does not print any warnings', async () => {
      getBuildProfileDeprecationWarningsAsync.mockImplementation(async () => []);
      const buildProfile = {} as BuildProfile<Platform.ANDROID>;
      await maybePrintBuildProfileDeprecationWarningsAsync(buildProfile, easJsonAccessor);
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
      const buildProfile = {} as BuildProfile<Platform.ANDROID>;
      await maybePrintBuildProfileDeprecationWarningsAsync(buildProfile, easJsonAccessor);
      expect(newLineSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(3);
      const warnCalls = warnSpy.mock.calls;
      expect(warnCalls[0][0]).toEqual('Detected deprecated fields in eas.json:');
      expect(warnCalls[1][0]).toEqual(
        '\tThe "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.'
      );
      const underlinedText = 'https://docs.expo.dev/build-reference/eas-json/#cache';
      const dimmedText = `Learn more: ${chalk.underline(underlinedText)}`;
      expect(warnCalls[2][0]).toEqual(`\t${chalk.dim(dimmedText)}`);
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
      const buildProfile = {} as BuildProfile<Platform.ANDROID>;
      await maybePrintBuildProfileDeprecationWarningsAsync(buildProfile, easJsonAccessor);
      expect(newLineSpy).toHaveBeenCalledTimes(4);
      expect(warnSpy).toHaveBeenCalledTimes(6);
      const warnCalls = warnSpy.mock.calls;
      expect(warnCalls[0][0]).toEqual('Detected deprecated fields in eas.json:');
      expect(warnCalls[1][0]).toEqual(
        '\tThe "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.'
      );
      let underlinedText = 'https://docs.expo.dev/build-reference/eas-json/#cache';
      let dimmedText = `Learn more: ${chalk.underline(underlinedText)}`;
      expect(warnCalls[2][0]).toEqual(`\t${chalk.dim(dimmedText)}`);
      expect(warnCalls[3][0]).toEqual(
        '\tThe "build.production.cache.cacheDefaultPaths" field in eas.json is deprecated and will be removed in the future.'
      );
      underlinedText = 'https://docs.expo.dev/build-reference/caching/#ios-dependencies';
      dimmedText = `Learn more: ${chalk.underline(underlinedText)}`;
      expect(warnCalls[4][0]).toEqual(`\t${chalk.dim(dimmedText)}`);
      expect(warnCalls[5][0]).toEqual('\tOther message');
    });
  });
});
