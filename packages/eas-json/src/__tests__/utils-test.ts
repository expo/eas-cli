import { EasJsonAccessor } from '../accessor';
import { AndroidBuildProfile, IosBuildProfile } from '../build/types';
import { EasJsonUtils } from '../utils';

describe('getBuildProfileDeprecationWarningsAsync', () => {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
  const readRawEasJsonMock = jest.spyOn(easJsonAccessor, 'readRawJsonAsync');
  describe('android', () => {
    type BuildProfileType = AndroidBuildProfile;
    describe('no cache settings', () => {
      const buildProfile = {} as BuildProfileType;
      it('does not return deprecation warnings', async () => {
        readRawEasJsonMock.mockImplementation(async () => {
          return {};
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          buildProfile,
          easJsonAccessor,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with paths', () => {
      const buildProfile = {
        cache: {
          paths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('does not return deprecation warnings', async () => {
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
          buildProfile,
          easJsonAccessor,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with customPaths', () => {
      const buildProfile = {
        cache: {
          paths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('returns deprecation warning', async () => {
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
          buildProfile,
          easJsonAccessor,
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
          buildProfile,
          easJsonAccessor,
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
      const buildProfile = {} as BuildProfileType;
      it('does not return deprecation warnings', async () => {
        readRawEasJsonMock.mockImplementation(async () => {
          return {};
        });
        const result = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
          buildProfile,
          easJsonAccessor,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with paths', () => {
      const buildProfile = {
        cache: {
          paths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('does not return deprecation warnings', async () => {
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
          buildProfile,
          easJsonAccessor,
          'production'
        );
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with customPaths', () => {
      const buildProfile = {
        cache: {
          paths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('returns deprecation warning', async () => {
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
          buildProfile,
          easJsonAccessor,
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
          buildProfile,
          easJsonAccessor,
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
      const buildProfile = {
        cache: {
          paths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('returns deprecation warning', async () => {
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
          buildProfile,
          easJsonAccessor,
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
});
