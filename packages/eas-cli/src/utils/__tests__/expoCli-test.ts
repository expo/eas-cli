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
    jest.mocked(resolveFrom.silent).mockImplementationOnce(() => undefined);
    expect(shouldUseVersionedExpoCLIExpensive('/', DEFAULT_CONFIG)).toBe(false);
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
