import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils, errors } from '@expo/eas-json';

import { selectAsync } from '../../prompts';
import { getProfilesAsync } from '../profiles';

jest.mock('../../prompts');
jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');

  const EasJsonUtilsMock = jest.fn();
  EasJsonUtilsMock.prototype = {
    getBuildProfileAsync: jest.fn(),
    getBuildProfileNamesAsync: jest.fn(),
  };
  return {
    ...actual,
    EasJsonUtils: EasJsonUtilsMock,
  };
});

const getBuildProfileAsync = jest.spyOn(EasJsonUtils.prototype, 'getBuildProfileAsync');
const getBuildProfileNamesAsync = jest.spyOn(EasJsonUtils.prototype, 'getBuildProfileNamesAsync');

describe(getProfilesAsync, () => {
  afterEach(() => {
    getBuildProfileAsync.mockReset();
    getBuildProfileNamesAsync.mockReset();
    jest.mocked(selectAsync).mockReset();
  });

  it('defaults to production profile', async () => {
    const result = await getProfilesAsync({
      easJsonUtils: new EasJsonUtils(new EasJsonAccessor('/fake')),
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      type: 'build',
    });

    expect(result[0].profileName).toBe('production');
    expect(result[1].profileName).toBe('production');
    expect(getBuildProfileAsync).toBeCalledWith(Platform.ANDROID, undefined);
    expect(getBuildProfileAsync).toBeCalledWith(Platform.IOS, undefined);
  });

  it('throws an error if there are no profiles in eas.json', async () => {
    getBuildProfileAsync.mockImplementation(async () => {
      throw new errors.MissingProfileError();
    });
    getBuildProfileNamesAsync.mockImplementation(() => Promise.resolve([]));

    await expect(
      getProfilesAsync({
        easJsonUtils: new EasJsonUtils(new EasJsonAccessor('/fake')),
        platforms: [Platform.ANDROID],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(errors.MissingProfileError);
  });

  it('gets a specific profile', async () => {
    const result = await getProfilesAsync({
      easJsonUtils: new EasJsonUtils(new EasJsonAccessor('/fake')),
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
        easJsonUtils: new EasJsonUtils(new EasJsonAccessor('/fake')),
        platforms: [Platform.ANDROID, Platform.IOS],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(/eas.json is not valid/);
  });
});
