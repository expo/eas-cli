import nock from 'nock';

import { AnalyticsWithOrchestration } from '../../../analytics/AnalyticsManager';
import { getExpoApiBaseUrl } from '../../../api';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import SessionManager from '../../../user/SessionManager';
import { ContextOptions } from '../ContextField';
import LoggedInContextField from '../LoggedInContextField';
import { getProjectIdAsync } from '../contextUtils/getProjectIdAsync';

const app = {
  __typename: 'App',
  id: 'PROJECT_ID',
  name: 'app',
  fullName: '@owner/app',
  slug: 'app',
  ownerAccount: { __typename: 'Account', id: 'ACCOUNT_ID', name: 'owner' },
  githubRepository: null,
};

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe(LoggedInContextField, () => {
  it('shares the GraphQL cache with the project ID check', async () => {
    const analytics: AnalyticsWithOrchestration = {
      logEvent: jest.fn(),
      setActor: jest.fn(),
      flushAsync: jest.fn(),
      getDeviceId: jest.fn(() => null),
    };
    const sessionManager = new SessionManager(analytics);
    jest.spyOn(sessionManager, 'ensureLoggedInAsync').mockResolvedValue({
      actor: { __typename: 'User', id: 'USER_ID', username: 'owner' } as any,
      authenticationInfo: { accessToken: 'token', sessionSecret: null },
    });
    const scope = nock(getExpoApiBaseUrl())
      .post('/graphql')
      .once()
      .reply(200, { data: { app: { __typename: 'AppQuery', byId: app } } });

    const projectId = await getProjectIdAsync(
      sessionManager,
      { name: 'app', slug: 'app', extra: { eas: { projectId: 'PROJECT_ID' } } },
      { nonInteractive: true }
    );
    const { graphqlClient } = await new LoggedInContextField().getValueAsync({
      sessionManager,
      nonInteractive: true,
    } as ContextOptions);

    expect(await AppQuery.byIdAsync(graphqlClient, projectId)).toMatchObject({
      fullName: '@owner/app',
    });
    expect(scope.isDone()).toBe(true);
  });
});
