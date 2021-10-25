import { Platform } from '@expo/eas-build-job';
import { errors } from '@expo/eas-json';

import { getProfilesAsync } from '../profiles';

describe(getProfilesAsync, () => {
  it('defaults to production profile', async () => {
    const readProfileAsync = jest.fn();
    const result = await getProfilesAsync({
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      readProfileAsync,
    });

    expect(result[0].profileName).toBe('production');
    expect(result[1].profileName).toBe('production');
    expect(readProfileAsync).toBeCalledWith(Platform.ANDROID, 'production');
    expect(readProfileAsync).toBeCalledWith(Platform.IOS, 'production');
  });

  it('defaults to release profile when production profile is non-existent', async () => {
    const readProfileAsync = jest
      .fn()
      .mockRejectedValueOnce(() => {
        throw new Error();
      })
      .mockRejectedValueOnce(() => {
        throw new Error();
      });

    const result = await getProfilesAsync({
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      readProfileAsync,
    });

    expect(result[0].profileName).toBe('release');
    expect(result[1].profileName).toBe('release');
    expect(readProfileAsync).toBeCalledWith(Platform.ANDROID, 'production');
    expect(readProfileAsync).toBeCalledWith(Platform.IOS, 'production');
    expect(readProfileAsync).toBeCalledWith(Platform.ANDROID, 'release');
    expect(readProfileAsync).toBeCalledWith(Platform.IOS, 'release');
  });

  it('fails when neither production or release profiles are present', async () => {
    const readProfileAsync = jest
      .fn()
      .mockRejectedValueOnce(() => {
        throw new Error();
      })
      .mockRejectedValueOnce(() => {
        throw new Error();
      });

    await expect(
      getProfilesAsync({
        platforms: [Platform.ANDROID],
        profileName: undefined,
        readProfileAsync,
      })
    ).rejects.toThrowError(/There is no profile named "production" in eas.json/);
  });

  it('gets a specific profile', async () => {
    const readProfileAsync = jest.fn();
    const result = await getProfilesAsync({
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: 'custom-profile',
      readProfileAsync,
    });

    expect(result[0].profileName).toBe('custom-profile');
    expect(result[1].profileName).toBe('custom-profile');
    expect(readProfileAsync).toBeCalledWith(Platform.ANDROID, 'custom-profile');
    expect(readProfileAsync).toBeCalledWith(Platform.IOS, 'custom-profile');
  });

  it('throws validation error if eas.json is invalid', async () => {
    const readProfileAsync = jest.fn().mockImplementation(() => {
      throw new errors.InvalidEasJsonError('eas.json is not valid');
    });

    await expect(
      getProfilesAsync({
        platforms: [Platform.ANDROID, Platform.IOS],
        profileName: undefined,
        readProfileAsync,
      })
    ).rejects.toThrowError(/eas.json is not valid/);
  });
});
