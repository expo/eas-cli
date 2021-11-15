import { Platform } from '@expo/eas-build-job';
import { EasJsonReader, errors } from '@expo/eas-json';

import { getProfilesAsync } from '../profiles';

jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');

  const EasJsonReaderMock = jest.fn();
  EasJsonReaderMock.prototype = {
    readBuildProfileAsync: jest.fn(),
    readSubmitProfileAsync: jest.fn(),
  };
  return {
    ...actual,
    EasJsonReader: EasJsonReaderMock,
  };
});

const readBuildProfileAsync = jest.spyOn(EasJsonReader.prototype, 'readBuildProfileAsync');

describe(getProfilesAsync, () => {
  afterEach(() => {
    readBuildProfileAsync.mockReset();
  });

  it('defaults to production profile', async () => {
    const result = await getProfilesAsync({
      projectDir: '/fake',
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      type: 'build',
    });

    expect(result[0].profileName).toBe('production');
    expect(result[1].profileName).toBe('production');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'production');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.IOS, 'production');
  });

  it('defaults to release profile when production profile is non-existent', async () => {
    readBuildProfileAsync
      .mockRejectedValueOnce(() => {
        throw new Error();
      })
      .mockRejectedValueOnce(() => {
        throw new Error();
      });

    const result = await getProfilesAsync({
      projectDir: '/fake',
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      type: 'build',
    });

    expect(result[0].profileName).toBe('release');
    expect(result[1].profileName).toBe('release');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'production');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.IOS, 'production');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'release');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.IOS, 'release');
  });

  it('fails when neither production or release profiles are present', async () => {
    readBuildProfileAsync
      .mockRejectedValueOnce(() => {
        throw new Error();
      })
      .mockRejectedValueOnce(() => {
        throw new Error();
      });

    await expect(
      getProfilesAsync({
        projectDir: '/fake',
        platforms: [Platform.ANDROID],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(/There is no build profile named "production" in eas.json/);
  });

  it('gets a specific profile', async () => {
    const result = await getProfilesAsync({
      projectDir: '/fake',
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: 'custom-profile',
      type: 'build',
    });

    expect(result[0].profileName).toBe('custom-profile');
    expect(result[1].profileName).toBe('custom-profile');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'custom-profile');
    expect(readBuildProfileAsync).toBeCalledWith(Platform.IOS, 'custom-profile');
  });

  it('throws validation error if eas.json is invalid', async () => {
    readBuildProfileAsync.mockImplementation(() => {
      throw new errors.InvalidEasJsonError('eas.json is not valid');
    });

    await expect(
      getProfilesAsync({
        projectDir: '/fake',
        platforms: [Platform.ANDROID, Platform.IOS],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(/eas.json is not valid/);
  });
});
