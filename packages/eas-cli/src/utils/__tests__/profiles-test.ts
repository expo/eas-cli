import { Platform } from '@expo/eas-build-job';
import { EasJsonReader, errors } from '@expo/eas-json';

import { getProfilesAsync } from '../profiles';

jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');

  const EasJsonReaderMock = jest.fn();
  EasJsonReaderMock.prototype = {
    getBuildProfileAsync: jest.fn(),
    getSubmitProfileAsync: jest.fn(),
  };
  return {
    ...actual,
    EasJsonReader: EasJsonReaderMock,
  };
});

const getBuildProfileAsync = jest.spyOn(EasJsonReader.prototype, 'getBuildProfileAsync');

describe(getProfilesAsync, () => {
  afterEach(() => {
    getBuildProfileAsync.mockReset();
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
    expect(getBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'production');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.IOS, 'production');
  });

  it('defaults to release profile when production profile is non-existent', async () => {
    getBuildProfileAsync
      .mockImplementationOnce(() => {
        throw new errors.MissingProfileError();
      })
      .mockImplementationOnce(() => {
        throw new errors.MissingProfileError();
      });

    const result = await getProfilesAsync({
      projectDir: '/fake',
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      type: 'build',
    });

    expect(result[0].profileName).toBe('release');
    expect(result[1].profileName).toBe('release');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'production');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.IOS, 'production');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'release');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.IOS, 'release');
  });

  it('fails when neither production or release profiles are present', async () => {
    getBuildProfileAsync.mockImplementation(() => {
      throw new errors.MissingProfileError();
    });

    await expect(
      getProfilesAsync({
        projectDir: '/fake',
        platforms: [Platform.ANDROID],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(errors.MissingProfileError);
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
    expect(getBuildProfileAsync).toBeCalledWith(Platform.ANDROID, 'custom-profile');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.IOS, 'custom-profile');
  });

  it('throws validation error if eas.json is invalid', async () => {
    getBuildProfileAsync.mockImplementation(() => {
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
