import { getConfig } from '@expo/config';
import resolveFrom from 'resolve-from';

import { shouldUseVersionedExpoCLIExpensive } from '../expoCli';

jest.mock('resolve-from', () => ({
  silent: jest.fn(() => '/path/to/@expo/cli'),
}));

jest.mock('@expo/config', () => ({
  getConfig: jest.fn(() => ({
    pkg: {},
    exp: {
      sdkVersion: '46.0.0',
      name: 'my-app',
      slug: 'my-app',
    },
  })),
}));

const originalEnv = process.env;

afterAll(() => {
  process.env = originalEnv;
});

describe(shouldUseVersionedExpoCLIExpensive, () => {
  beforeEach(() => {
    delete process.env.EXPO_USE_LOCAL_CLI;
  });

  // There are meany conditions and all should be enabled by default in this
  // describe block.
  it(`returns true if all conditions are met (sanity)`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(true);
  });

  it(`returns true if EXPO_USE_LOCAL_CLI is unset`, () => {
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(true);
  });

  it(`returns false if EXPO_USE_LOCAL_CLI is set to false`, () => {
    ['false', '0'].forEach(falsey => {
      process.env.EXPO_USE_LOCAL_CLI = falsey;
      expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(false);
    });
  });
  it(`returns true if EXPO_USE_LOCAL_CLI is set to a truthy value`, () => {
    ['true', '1'].forEach(truthy => {
      process.env.EXPO_USE_LOCAL_CLI = truthy;
      expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(true);
    });
  });

  it(`returns false if versioned CLI isn't installed`, () => {
    jest.mocked(resolveFrom.silent).mockImplementationOnce(() => undefined);
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(false);
  });

  it(`returns false if the Expo SDK version is less than 46`, () => {
    jest
      .mocked(getConfig)
      .mockImplementationOnce(() => ({ exp: { sdkVersion: '45.0.0' }, pkg: {} } as any));
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(false);
  });
  it(`returns true if the Expo SDK version is UNVERSIONED`, () => {
    jest
      .mocked(getConfig)
      .mockImplementationOnce(() => ({ exp: { sdkVersion: 'UNVERSIONED' }, pkg: {} } as any));
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(true);
  });
  it(`returns true if the Expo SDK version is an invalid format`, () => {
    jest
      .mocked(getConfig)
      .mockImplementationOnce(() => ({ exp: { sdkVersion: 'foobar' }, pkg: {} } as any));
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(true);
  });
  it(`returns true if the Expo SDK version is undefined`, () => {
    jest.mocked(getConfig).mockImplementationOnce(() => ({ exp: {}, pkg: {} } as any));
    expect(shouldUseVersionedExpoCLIExpensive('/')).toBe(true);
  });
});
