import { Platform } from '@expo/eas-build-job';

import { getDefaultProfilesAsync } from '../profiles';

describe(getDefaultProfilesAsync, () => {
  test('defaults to production profile', async () => {
    const callback = jest.fn();
    const result = await getDefaultProfilesAsync({
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      readProfileAsync: callback,
    });

    expect(result[0].profileName).toBe('production');
    expect(result[1].profileName).toBe('production');
    expect(callback).toBeCalledWith(Platform.ANDROID, 'production');
    expect(callback).toBeCalledWith(Platform.IOS, 'production');
  });

  test('defaults to release profile when production profile is non-existent', async () => {
    const callback = jest
      .fn()
      .mockRejectedValueOnce(() => {
        throw new Error();
      })
      .mockRejectedValueOnce(() => {
        throw new Error();
      });

    const result = await getDefaultProfilesAsync({
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      readProfileAsync: callback,
    });

    expect(result[0].profileName).toBe('release');
    expect(result[1].profileName).toBe('release');
    expect(callback).toBeCalledWith(Platform.ANDROID, 'production');
    expect(callback).toBeCalledWith(Platform.IOS, 'production');
    expect(callback).toBeCalledWith(Platform.ANDROID, 'release');
    expect(callback).toBeCalledWith(Platform.IOS, 'release');
  });

  test('fails when neither production or release profiles are present', async () => {
    const callback = jest
      .fn()
      .mockRejectedValueOnce(() => {
        throw new Error();
      })
      .mockRejectedValueOnce(() => {
        throw new Error();
      });
    let error;

    try {
      await getDefaultProfilesAsync({
        platforms: [Platform.ANDROID],
        profileName: undefined,
        readProfileAsync: callback,
      });
    } catch (_error) {
      error = _error;
    }

    expect(error).toStrictEqual(new Error('There is no profile named "production" in eas.json'));
  });

  test('gets a specific profile', async () => {
    const callback = jest.fn();
    const result = await getDefaultProfilesAsync({
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: 'custom-profile',
      readProfileAsync: callback,
    });

    expect(result[0].profileName).toBe('custom-profile');
    expect(result[1].profileName).toBe('custom-profile');
    expect(callback).toBeCalledWith(Platform.ANDROID, 'custom-profile');
    expect(callback).toBeCalledWith(Platform.IOS, 'custom-profile');
  });
});
