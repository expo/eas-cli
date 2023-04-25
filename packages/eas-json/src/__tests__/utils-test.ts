import { Platform } from '@expo/eas-build-job';

import { EasJsonAccessor } from '../accessor';
import { AndroidBuildProfile, IosBuildProfile } from '../build/types';
import { EasJsonUtils } from '../utils';

jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');

  const EasJsonUtilsMock = {
    getBuildProfileAsync: jest.fn(),
  };
  return {
    ...actual,
    EasJsonUtils: EasJsonUtilsMock,
  };
});
const getBuildProfileAsync = jest.spyOn(EasJsonUtils, 'getBuildProfileAsync');

describe('getBuildProfileDeprecationWarningsAsync', () => {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
  const readRawEasJsonMock = jest.spyOn(easJsonAccessor, 'readRawJsonAsync');
  describe('android', () => {
    type BuildProfileType = AndroidBuildProfile;
    describe('no cache settings', () => {
      it('does not return deprecation warnings', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {} as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {};
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.ANDROID,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with paths', () => {
      it('does not return deprecation warnings', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {
            cache: {
              paths: ['path1', 'path2'],
            },
          } as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {
            build: {
              production: {
                cache: {
                  paths: ['path1', 'path2'],
                },
              },
            },
          };
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.ANDROID,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with customPaths', () => {
      it('returns deprecation warning', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {
            cache: {
              paths: ['path1', 'path2'],
            },
          } as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {
            build: {
              production: {
                cache: {
                  customPaths: ['path1', 'path2'],
                },
              },
              dummy_profile_name: {
                cache: {
                  customPaths: ['path1', 'path2'],
                },
              },
            },
          };
        });
        let result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.ANDROID,
          'production'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
        result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.ANDROID,
          'dummy_profile_name'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.dummy_profile_name.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.dummy_profile_name.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
      });
    });
  });
  describe('ios', () => {
    type BuildProfileType = IosBuildProfile;
    describe('no cache settings', () => {
      it('does not return deprecation warnings', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {} as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {};
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.IOS,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with paths', () => {
      it('does not return deprecation warnings', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {
            cache: {
              paths: ['path1', 'path2'],
            },
          } as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {
            build: {
              production: {
                cache: {
                  paths: ['path1', 'path2'],
                },
              },
            },
          };
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.IOS,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with customPaths', () => {
      it('returns deprecation warning', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {
            cache: {
              paths: ['path1', 'path2'],
            },
          } as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {
            build: {
              production: {
                cache: {
                  customPaths: ['path1', 'path2'],
                },
              },
              dummy_profile_name: {
                cache: {
                  customPaths: ['path1', 'path2'],
                },
              },
            },
          };
        });
        let result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.IOS,
          'production'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
        result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.IOS,
          'dummy_profile_name'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.dummy_profile_name.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.dummy_profile_name.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
      });
    });
    describe('cache settings with customPaths in extended profile', () => {
      it('returns deprecation warning', async () => {
        getBuildProfileAsync.mockImplementation(async () => {
          return {
            cache: {
              paths: ['path1', 'path2'],
            },
          } as BuildProfileType;
        });
        readRawEasJsonMock.mockImplementation(async () => {
          return {
            build: {
              production: {
                cache: {
                  customPaths: ['path1', 'path2'],
                },
              },
              dummy_profile_name: {
                extends: 'production',
              },
            },
          };
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          easJsonAccessor,
          Platform.IOS,
          'dummy_profile_name'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
      });
    });
  });
});
