import { Platform } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils, errors } from '@expo/eas-json';

import { selectAsync } from '../../prompts';
import { getProfilesAsync } from '../profiles';

jest.mock('../../prompts');
jest.mock('@expo/eas-json', () => {
  const actual = jest.requireActual('@expo/eas-json');

  const EasJsonUtilsMock = {
    getBuildProfileAsync: jest.fn(),
    getBuildProfileNamesAsync: jest.fn(),
    getBuildProfileDepreactionWarnings: jest.fn(() => []),
  };
  return {
    ...actual,
    EasJsonUtils: EasJsonUtilsMock,
  };
});

const getBuildProfileAsync = jest.spyOn(EasJsonUtils, 'getBuildProfileAsync');
const getBuildProfileNamesAsync = jest.spyOn(EasJsonUtils, 'getBuildProfileNamesAsync');

describe(getProfilesAsync, () => {
  afterEach(() => {
    getBuildProfileAsync.mockReset();
    getBuildProfileNamesAsync.mockReset();
    jest.mocked(selectAsync).mockReset();
  });

  it('defaults to production profile', async () => {
    const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
    const result = await getProfilesAsync({
      easJsonAccessor,
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: undefined,
      type: 'build',
    });

    expect(result[0].profileName).toBe('production');
    expect(result[1].profileName).toBe('production');
    expect(getBuildProfileAsync).toBeCalledWith(easJsonAccessor, Platform.ANDROID, undefined);
    expect(getBuildProfileAsync).toBeCalledWith(easJsonAccessor, Platform.IOS, undefined);
  });

  it('throws an error if there are no profiles in eas.json', async () => {
    getBuildProfileAsync.mockImplementation(async () => {
      throw new errors.MissingProfileError();
    });
    getBuildProfileNamesAsync.mockImplementation(() => Promise.resolve([]));

    await expect(
      getProfilesAsync({
        easJsonAccessor: EasJsonAccessor.fromProjectPath('/fake'),
        platforms: [Platform.ANDROID],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(errors.MissingProfileError);
  });

  it('gets a specific profile', async () => {
    const easJsonAccessor = EasJsonAccessor.fromProjectPath('/fake');
    const result = await getProfilesAsync({
      easJsonAccessor,
      platforms: [Platform.ANDROID, Platform.IOS],
      profileName: 'custom-profile',
      type: 'build',
    });

    expect(result[0].profileName).toBe('custom-profile');
    expect(result[1].profileName).toBe('custom-profile');
    expect(getBuildProfileAsync).toBeCalledWith(
      easJsonAccessor,
      Platform.ANDROID,
      'custom-profile'
    );
    expect(getBuildProfileAsync).toBeCalledWith(easJsonAccessor, Platform.IOS, 'custom-profile');
  });

  it('throws validation error if eas.json is invalid', async () => {
    getBuildProfileAsync.mockImplementation(() => {
      throw new errors.InvalidEasJsonError('eas.json is not valid');
    });

    await expect(
      getProfilesAsync({
        easJsonAccessor: EasJsonAccessor.fromProjectPath('/fake'),
        platforms: [Platform.ANDROID, Platform.IOS],
        profileName: undefined,
        type: 'build',
      })
    ).rejects.toThrowError(/eas.json is not valid/);
  });
});
