import mockdate from 'mockdate';
import nullthrows from 'nullthrows';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../../../log';
import { IosAppCredentialsQuery } from '../../api/graphql/queries/IosAppCredentialsQuery';
import { App, Target } from '../../types';
import { displayIosCredentials } from '../printCredentials';

jest.mock('../../../../log');
jest.mock('chalk', () => ({ bold: jest.fn(log => log), cyan: { bold: jest.fn(log => log) } }));

jest.mock('../../api/graphql/queries/IosAppCredentialsQuery');
mockdate.set(new Date('4/20/2021'));

describe('print credentials', () => {
  it('prints the IosAppCredentials map', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const app: App = {
      account: {
        id: 'account-id',
        name: 'quinlanj',
        users: [],
      },
      projectName: 'test52',
    };
    const testIosAppCredentialsData =
      await IosAppCredentialsQuery.withCommonFieldsByAppIdentifierIdAsync(
        graphqlClient,
        '@quinlanj/test52',
        {
          appleAppIdentifierId: 'test-id',
        }
      );
    const appCredentials = {
      test52: nullthrows(testIosAppCredentialsData),
    };
    const targets: Target[] = [
      { targetName: 'test52', bundleIdentifier: 'com.quinlanj.test52', entitlements: {} },
    ];
    displayIosCredentials(app, appCredentials, targets);
    const loggedSoFar = jest
      .mocked(Log.log)
      .mock.calls.reduce((acc, mockValue) => acc + mockValue, '');
    expect(loggedSoFar).toMatchSnapshot();
  });
});
