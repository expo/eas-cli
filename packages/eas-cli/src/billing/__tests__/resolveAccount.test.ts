import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { Permission, Role } from '../../graphql/generated';
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

  function account(name: string, role: Role): Actor['accounts'][number] {
    return {
      id: `${name}-id`,
      name,
      viewerUserPermission: { role },
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
      resolveAsync([account('viewer', Role.ViewOnly), account('admin', Role.Admin)])
    ).resolves.toEqual({ id: 'admin-id', name: 'admin', subscription: null });
  });

  it.each([
    ['account owners', Role.Owner],
    ['custom roles with admin permission', Role.HasAdmin],
  ])('allows %s to manage billing', async (_case, role) => {
    await expect(resolveAsync([account('team', role)])).resolves.toEqual({
      id: 'team-id',
      name: 'team',
      subscription: null,
    });
  });

  it('allows the owner of a personal account to manage billing', async () => {
    const ownerAccount = {
      ...account('personal', Role.ViewOnly),
      ownerUserActor: { __typename: 'User', id: 'actor-id', username: 'personal' },
    } as Actor['accounts'][number];

    await expect(resolveAsync([ownerAccount])).resolves.toEqual({
      id: 'personal-id',
      name: 'personal',
      subscription: null,
    });
  });

  it('rejects an explicitly selected account without billing permission', async () => {
    await expect(resolveAsync([account('developer', Role.Developer)], 'developer')).rejects.toThrow(
      'You must be an Owner or Admin of account "developer" to manage billing.'
    );
    expect(AccountQuery.getByNameAsync).not.toHaveBeenCalled();
  });

  it('rejects an account lookup without billing permission', async () => {
    jest.mocked(AccountQuery.getByNameAsync).mockResolvedValue({
      id: 'viewer-id',
      name: 'viewer',
      viewerUserPermission: { id: 'viewer-permission-id', permissions: [Permission.View] },
    });

    await expect(resolveAsync([], 'viewer')).rejects.toThrow(
      'You must be an Owner or Admin of account "viewer" to manage billing.'
    );
  });

  it('fails when no account has billing permission', async () => {
    await expect(resolveAsync([account('viewer', Role.ViewOnly)])).rejects.toThrow(
      'You must be an Owner or Admin of at least one account to manage billing.'
    );
  });
});
