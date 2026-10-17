import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Permission } from '../../graphql/generated';
import { AccountQuery } from '../../graphql/queries/AccountQuery';
import { Actor } from '../../user/User';
import { resolveBillingAccountAsync } from '../resolveAccount';

jest.mock('../../graphql/queries/AccountQuery');

describe(resolveBillingAccountAsync, () => {
  const graphqlClient = {} as ExpoGraphqlClient;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(AccountQuery.getSubscriptionAsync).mockResolvedValue(null);
  });

  function account(
    name: string,
    permissions: Permission[],
    effectivePermissions: Permission[] = permissions
  ): Actor['accounts'][number] {
    return {
      id: `${name}-id`,
      name,
      viewerUserPermission2: { permissions, effectivePermissions },
    } as Actor['accounts'][number];
  }

  function actor(accounts: Actor['accounts']): Actor {
    return { id: 'actor-id', accounts } as Actor;
  }

  async function resolveAsync(
    accounts: Actor['accounts'],
    accountName?: string
  ): ReturnType<typeof resolveBillingAccountAsync> {
    return await resolveBillingAccountAsync({
      graphqlClient,
      actor: actor(accounts),
      accountName,
      nonInteractive: true,
      subscriptionFilter: 'unsubscribed',
    });
  }

  it('automatically selects the only account with billing permission', async () => {
    await expect(
      resolveAsync([
        account('viewer', [Permission.View]),
        account('admin', [Permission.Admin, Permission.View]),
      ])
    ).resolves.toEqual({ id: 'admin-id', name: 'admin', subscription: null });
  });

  it.each([
    ['account owners', [Permission.Own, Permission.View]],
    ['custom roles with admin permission', [Permission.Admin, Permission.View]],
  ])('allows %s to manage billing', async (_case, role) => {
    await expect(resolveAsync([account('team', role)])).resolves.toEqual({
      id: 'team-id',
      name: 'team',
      subscription: null,
    });
  });

  it('allows the owner of a personal account to manage billing', async () => {
    const ownerAccount = {
      ...account('personal', [Permission.Own, Permission.Admin, Permission.View]),
      ownerUserActor: { __typename: 'User', id: 'actor-id', username: 'personal' },
    } as Actor['accounts'][number];

    await expect(resolveAsync([ownerAccount])).resolves.toEqual({
      id: 'personal-id',
      name: 'personal',
      subscription: null,
    });
  });

  it('skips accounts where the credential scopes remove billing permission', async () => {
    await expect(
      resolveAsync([
        account('scoped', [Permission.Admin, Permission.View], [Permission.View]),
        account('admin', [Permission.Admin, Permission.View]),
      ])
    ).resolves.toEqual({ id: 'admin-id', name: 'admin', subscription: null });
  });

  it('rejects an explicitly selected account where the credential scopes remove billing permission', async () => {
    await expect(
      resolveAsync([account('team', [Permission.Own, Permission.View], [Permission.View])], 'team')
    ).rejects.toThrow(
      'You are an Owner or Admin of account "team", but the permissions granted during authentication do not allow you to manage billing.'
    );
  });

  it('rejects the personal account of the owner when the credential scopes remove billing permission', async () => {
    const ownerAccount = {
      ...account(
        'personal',
        [Permission.Own, Permission.Admin, Permission.View],
        [Permission.View]
      ),
      ownerUserActor: { __typename: 'User', id: 'actor-id', username: 'personal' },
    } as Actor['accounts'][number];

    await expect(resolveAsync([ownerAccount], 'personal')).rejects.toThrow(
      'You are an Owner or Admin of account "personal", but the permissions granted during authentication do not allow you to manage billing.'
    );
  });

  it('rejects an explicitly selected account without billing permission', async () => {
    await expect(
      resolveAsync([account('developer', [Permission.Publish, Permission.View])], 'developer')
    ).rejects.toThrow('You must be an Owner or Admin of account "developer" to manage billing.');
    expect(AccountQuery.getByNameAsync).not.toHaveBeenCalled();
  });

  it('rejects an account lookup without billing permission', async () => {
    jest.mocked(AccountQuery.getByNameAsync).mockResolvedValue({
      id: 'viewer-id',
      name: 'viewer',
      viewerUserPermission2: {
        id: 'viewer-permission-id',
        permissions: [Permission.View],
        effectivePermissions: [Permission.View],
      },
    });

    await expect(resolveAsync([], 'viewer')).rejects.toThrow(
      'You must be an Owner or Admin of account "viewer" to manage billing.'
    );
  });

  it('rejects an account lookup where the credential scopes remove billing permission', async () => {
    jest.mocked(AccountQuery.getByNameAsync).mockResolvedValue({
      id: 'org-id',
      name: 'org',
      viewerUserPermission2: {
        id: 'org-permission-id',
        permissions: [Permission.Admin, Permission.View],
        effectivePermissions: [Permission.View],
      },
    });

    await expect(resolveAsync([], 'org')).rejects.toThrow(
      'You are an Owner or Admin of account "org", but the permissions granted during authentication do not allow you to manage billing.'
    );
  });

  it('fails when no account has billing permission', async () => {
    await expect(resolveAsync([account('viewer', [Permission.View])])).rejects.toThrow(
      'You must be an Owner or Admin of at least one account to manage billing.'
    );
  });

  it('fails when the credential scopes remove billing permission from every account', async () => {
    await expect(
      resolveAsync([account('team', [Permission.Admin, Permission.View], [Permission.View])])
    ).rejects.toThrow(
      'You are an Owner or Admin of at least one account, but the permissions granted during authentication do not allow you to manage billing.'
    );
  });
});
