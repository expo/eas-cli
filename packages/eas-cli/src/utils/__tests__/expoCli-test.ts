import resolveFrom from 'resolve-from';

import { shouldUseVersionedExpoCLIExpensive } from '../expoCli';

jest.mock('resolve-from', () => ({
  silent: jest.fn(() => '/path/to/@expo/cli'),
}));

const originalEnv = process.env;

afterAll(() => {
  process.env = originalEnv;
});

const DEFAULT_CONFIG = { sdkVersion: '46.0.0' };

describe(shouldUseVersionedExpoCLIExpensive, () => {
  beforeEach(() => {
    delete process.env.EXPO_USE_LOCAL_CLI;
  });

  // There are meany conditions and all should be enabled by default in this
  // describe block.
  it(`returns true if all conditions are met (sanity)`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/', DEFAULT_CONFIG)).toBe(true);
  });

  it(`returns true if EXPO_USE_LOCAL_CLI is unset`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/', DEFAULT_CONFIG)).toBe(true);
  });

  it(`returns false if EXPO_USE_LOCAL_CLI is set to false`, () => {
    ['false', '0'].forEach(falsey => {
      process.env.EXPO_USE_LOCAL_CLI = falsey;
      expect(shouldUseVersionedExpoCLIExpensive('/', DEFAULT_CONFIG)).toBe(false);
    });
  });
  it(`returns true if EXPO_USE_LOCAL_CLI is set to a truthy value`, () => {
    ['true', '1'].forEach(truthy => {
      process.env.EXPO_USE_LOCAL_CLI = truthy;
      expect(shouldUseVersionedExpoCLIExpensive('/', DEFAULT_CONFIG)).toBe(true);
    });
  });

  it(`returns false if versioned CLI isn't installed`, () => {
    // Neither @expo/cli nor the expo package that could nest it resolves.
    jest.mocked(resolveFrom.silent).mockImplementationOnce(() => undefined);
    jest.mocked(resolveFrom.silent).mockImplementationOnce(() => undefined);
    expect(shouldUseVersionedExpoCLIExpensive('/', DEFAULT_CONFIG)).toBe(false);
  });

  it(`returns true if @expo/cli is only installed nested under the expo package`, () => {
    // npm can leave @expo/cli at node_modules/expo/node_modules/@expo/cli, where it
    // can't be resolved from the project root but expo/bin/cli finds it.
    const resolveNestedOnly = (from: string, request: string): string | undefined => {
      if (from === '/project' && request === 'expo/package.json') {
        return '/project/node_modules/expo/package.json';
      }
      if (from === '/project/node_modules/expo' && request === '@expo/cli') {
        return '/project/node_modules/expo/node_modules/@expo/cli/build/bin/cli';
      }
      return undefined;
    };
    jest.mocked(resolveFrom.silent).mockImplementationOnce(resolveNestedOnly);
    jest.mocked(resolveFrom.silent).mockImplementationOnce(resolveNestedOnly);
    jest.mocked(resolveFrom.silent).mockImplementationOnce(resolveNestedOnly);
    expect(shouldUseVersionedExpoCLIExpensive('/project', DEFAULT_CONFIG)).toBe(true);
  });

  it(`returns false if neither the project nor the expo package can resolve @expo/cli`, () => {
    const resolveExpoOnly = (from: string, request: string): string | undefined =>
      from === '/project' && request === 'expo/package.json'
        ? '/project/node_modules/expo/package.json'
        : undefined;
    jest.mocked(resolveFrom.silent).mockImplementationOnce(resolveExpoOnly);
    jest.mocked(resolveFrom.silent).mockImplementationOnce(resolveExpoOnly);
    jest.mocked(resolveFrom.silent).mockImplementationOnce(resolveExpoOnly);
    expect(shouldUseVersionedExpoCLIExpensive('/project', DEFAULT_CONFIG)).toBe(false);
  });

  it(`returns false if the Expo SDK version is less than 46`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/', { sdkVersion: '45.0.0' })).toBe(false);
  });
  it(`returns true if the Expo SDK version is UNVERSIONED`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/', { sdkVersion: 'UNVERSIONED' })).toBe(true);
  });
  it(`returns true if the Expo SDK version is an invalid format`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/', { sdkVersion: 'foobar' })).toBe(true);
  });
  it(`returns true if the Expo SDK version is undefined`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/', { sdkVersion: undefined })).toBe(true);
  });
});
