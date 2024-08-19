import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonUtils } from '@expo/eas-json';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { learnMore } from '../../../log';
import { getProjectConfigDescription } from '../../../project/projectUtils';
import { pressAnyKeyToContinueAsync } from '../../../prompts';
import { Actor } from '../../../user/User';
import { Client } from '../../../vcs/vcs';
import { getAppLookupParamsFromContextAsync } from '../../android/actions/BuildCredentialsUtils';
import { CredentialsContextProjectInfo } from '../../context';
import { AndroidPackageNotDefinedError } from '../../errors';
import { Action } from '../HelperActions';
import { ManageAndroid } from '../ManageAndroid';

jest.mock('../../android/actions/BuildCredentialsUtils');
jest.mock('../../../prompts', () => {
  return {
    ...jest.requireActual('../../../prompts'),
    pressAnyKeyToContinueAsync: jest.fn(),
  };
});
jest.mock('../../../project/projectUtils');

describe('runAsync', () => {
  describe('"android.package" missing in app.json', () => {
    const manageAndroid = new ManageAndroid(
      {
        projectInfo: {} as CredentialsContextProjectInfo,
        actor: {} as Actor,
        graphqlClient: {} as ExpoGraphqlClient,
        analytics: {} as Analytics,
        vcsClient: {} as Client,
        getDynamicPrivateProjectConfigAsync: jest
          .fn()
          .mockResolvedValue({ exp: {}, projectId: '' }),
        runAsync: jest.fn(),
      } as Action,
      ''
    );
    it('does not repeat the error indefinitely and prints useful error', async () => {
      jest.spyOn(EasJsonUtils, 'getBuildProfileNamesAsync').mockResolvedValue(['testProfile']);
      jest
        .spyOn(EasJsonUtils, 'getBuildProfileAsync')
        .mockResolvedValue({} as BuildProfile<Platform.ANDROID>);
      jest.mocked(getProjectConfigDescription).mockReturnValue('app.json');
      jest.mocked(getAppLookupParamsFromContextAsync).mockImplementation(() => {
        throw new AndroidPackageNotDefinedError(
          'Specify "android.package" in app.json and run this command again.'
        );
      });
      const pressAnyKeyToContinueAsyncMock = jest.mocked(pressAnyKeyToContinueAsync);
      Array.from(Array(100)).map((_, _i) => {
        // continue 101 times if error is rethrown indefinitely
        pressAnyKeyToContinueAsyncMock.mockResolvedValueOnce();
      });
      pressAnyKeyToContinueAsyncMock.mockImplementationOnce(async () => {
        // fail after 102nd time
        fail('test should not reach this place - if it does, the error repeats indefinitely');
      });
      const reThrownError = new AndroidPackageNotDefinedError(
        'Specify "android.package" in app.json and run this command again.\n' +
          `${learnMore(
            'https://docs.expo.dev/workflow/configuration/'
          )} about configuration with app.json/app.config.js`
      );
      await expect(manageAndroid.runAsync()).rejects.toThrow(reThrownError);
    });
  });
});
