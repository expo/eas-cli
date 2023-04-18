import { AndroidBuildProfile, IosBuildProfile } from '../build/types';
import { EasJsonUtils } from '../utils';

describe('getBuildProfileDeprecationWarnings', () => {
  describe('android', () => {
    type BuildProfileType = AndroidBuildProfile;
    describe('no cache settings', () => {
      const buildProfile = {} as BuildProfileType;
      it('does not return deprecation warnings', async () => {
        const result = EasJsonUtils.getBuildProfileDeprecationWarnings(buildProfile);
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
        const result = EasJsonUtils.getBuildProfileDeprecationWarnings(buildProfile);
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with customPaths', () => {
      const buildProfile = {
        cache: {
          customPaths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('returns deprecation warning', async () => {
        let result = EasJsonUtils.getBuildProfileDeprecationWarnings(buildProfile);
        expect(result).toEqual([
          {
            message: [
              `The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
        result = EasJsonUtils.getBuildProfileDeprecationWarnings(
          buildProfile,
          'dummy_profile_name'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.dummy_profile_name.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
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
        const result = EasJsonUtils.getBuildProfileDeprecationWarnings(buildProfile);
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
        const result = EasJsonUtils.getBuildProfileDeprecationWarnings(buildProfile);
        expect(result).toEqual([]);
      });
    });
    describe('cache settings with customPaths', () => {
      const buildProfile = {
        cache: {
          customPaths: ['path1', 'path2'],
        },
      } as BuildProfileType;
      it('returns deprecation warning', async () => {
        let result = EasJsonUtils.getBuildProfileDeprecationWarnings(buildProfile);
        expect(result).toEqual([
          {
            message: [
              `The "build.production.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
        result = EasJsonUtils.getBuildProfileDeprecationWarnings(
          buildProfile,
          'dummy_profile_name'
        );
        expect(result).toEqual([
          {
            message: [
              `The "build.dummy_profile_name.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.production.cache.paths" instead.`,
            ],
            docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
          },
        ]);
      });
    });
  });
});
