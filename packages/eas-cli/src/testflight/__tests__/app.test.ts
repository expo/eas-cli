import { App } from '@expo/apple-utils';
import { EasJsonUtils } from '@expo/eas-json';

import { resolveTestFlightAppAsync } from '../app';
import { CredentialsContext } from '../../credentials/context';
import { AppStoreConnectApiKeyQuery as AccountAppStoreConnectApiKeyQuery } from '../../credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery';
import { getRequestContext } from '../../credentials/ios/appstore/authenticate';
import { getAppStoreAuthAsync } from '../../metadata/auth';

jest.mock('@expo/apple-utils', () => ({
  App: { findAsync: jest.fn() },
  Token: jest.fn(),
}));
jest.mock('@expo/eas-json', () => ({
  EasJsonAccessor: { fromProjectPath: jest.fn() },
  EasJsonUtils: { getSubmitProfileAsync: jest.fn() },
}));
jest.mock('../../credentials/context', () => ({
  CredentialsContext: jest.fn(),
}));
jest.mock('../../credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery');
jest.mock('../../credentials/ios/appstore/authenticate', () => ({
  getRequestContext: jest.fn(),
}));
jest.mock('../../metadata/auth');
jest.mock('../../project/ios/bundleIdentifier', () => ({
  getBundleIdentifierAsync: jest.fn().mockResolvedValue('com.example.app'),
}));
jest.mock('../../project/projectUtils', () => ({
  getOwnerAccountForProjectIdAsync: jest
    .fn()
    .mockResolvedValue({ id: 'account-id', name: 'account-name' }),
}));

describe(resolveTestFlightAppAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(EasJsonUtils.getSubmitProfileAsync).mockResolvedValue({} as any);
    jest
      .mocked(getAppStoreAuthAsync)
      .mockRejectedValue(new Error('Configured API key cannot access the app'));
    jest.mocked(AccountAppStoreConnectApiKeyQuery.getAllForAccountAsync).mockResolvedValue([]);
  });

  it('forces Apple ID authentication for the final interactive fallback', async () => {
    const userAuthCtx = { authState: { context: { token: 'user-token' } } };
    const requestContext = { session: 'user' };
    const app = { attributes: { bundleId: 'com.example.app' } };
    const ensureUserAuthenticatedAsync = jest.fn().mockResolvedValue(userAuthCtx);
    jest.mocked(CredentialsContext).mockImplementation(
      () =>
        ({
          appStore: { ensureUserAuthenticatedAsync },
        }) as any
    );
    jest.mocked(getRequestContext).mockReturnValue(requestContext as any);
    jest.mocked(App.findAsync).mockResolvedValue(app as any);

    const result = await resolveTestFlightAppAsync({
      actor: {} as any,
      analytics: {} as any,
      exp: { slug: 'example' } as any,
      graphqlClient: {} as any,
      nonInteractive: false,
      projectDir: '/app',
      projectId: 'project-id',
      vcsClient: {} as any,
    });

    expect(getAppStoreAuthAsync).toHaveBeenCalledTimes(1);
    expect(ensureUserAuthenticatedAsync).toHaveBeenCalledTimes(1);
    expect(getRequestContext).toHaveBeenCalledWith(userAuthCtx);
    expect(App.findAsync).toHaveBeenCalledWith(requestContext, {
      bundleId: 'com.example.app',
    });
    expect(result).toBe(app);
  });
});
