import { AnalyticsWithOrchestration } from '../../../analytics/AnalyticsManager';
import SessionManager from '../../../user/SessionManager';
import { ContextOptions } from '../ContextField';
import DynamicLoggedInContextField from '../DynamicLoggedInContextField';

describe(DynamicLoggedInContextField, () => {
  it('uses the shared GraphQL client of the session manager', async () => {
    const analytics: AnalyticsWithOrchestration = {
      logEvent: jest.fn(),
      setActor: jest.fn(),
      flushAsync: jest.fn(),
    };
    const sessionManager = new SessionManager(analytics);
    const authenticationInfo = { accessToken: 'token', sessionSecret: null };
    jest.spyOn(sessionManager, 'ensureLoggedInAsync').mockResolvedValue({
      actor: { __typename: 'User', id: 'USER_ID', username: 'owner' } as any,
      authenticationInfo,
    });

    const getDynamicLoggedInAsync = await new DynamicLoggedInContextField().getValueAsync({
      sessionManager,
      nonInteractive: true,
    } as ContextOptions);
    const { graphqlClient } = await getDynamicLoggedInAsync();

    expect(graphqlClient).toBe(sessionManager.getGraphqlClient(authenticationInfo));
    expect((await getDynamicLoggedInAsync()).graphqlClient).toBe(graphqlClient);
  });
});
