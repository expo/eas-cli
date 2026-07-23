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
  });

  function account(name: string, role: Role): Actor['accounts'][number] {
    return {
      id: `${name}-id`,
      name,
      users: [{ actor: { id: 'actor-id' }, role }],
    } as Actor['accounts'][number];
  }

  function actor(accounts: Actor['accounts']): Actor {
    return { id: 'actor-id', accounts } as Actor;
  }

  it('automatically selects the only account with billing permission', async () => {
    const adminAccount = account('admin', Role.Admin);

    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([account('viewer', Role.ViewOnly), adminAccount]),
        accountName: undefined,
        nonInteractive: true,
      })
    ).resolves.toBe(adminAccount);
  });

  it('allows account owners to manage billing', async () => {
    const ownerAccount = account('owner', Role.Owner);

    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([ownerAccount]),
        accountName: undefined,
        nonInteractive: true,
      })
    ).resolves.toBe(ownerAccount);
  });

  it('allows custom roles with admin permission to manage billing', async () => {
    const adminAccount = account('custom-admin', Role.HasAdmin);

    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([adminAccount]),
        accountName: undefined,
        nonInteractive: true,
      })
    ).resolves.toBe(adminAccount);
  });

  it('allows the owner of a personal account to manage billing', async () => {
    const ownerAccount = {
      ...account('personal', Role.ViewOnly),
      ownerUserActor: { __typename: 'User', id: 'actor-id', username: 'personal' },
      users: [],
    } as Actor['accounts'][number];

    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([ownerAccount]),
        accountName: undefined,
        nonInteractive: true,
      })
    ).resolves.toBe(ownerAccount);
  });

  it('rejects an explicitly selected account without billing permission', async () => {
    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([account('developer', Role.Developer)]),
        accountName: 'developer',
        nonInteractive: true,
      })
    ).rejects.toThrow('You must be an Owner or Admin of account "developer" to manage billing.');
    expect(AccountQuery.getByNameAsync).not.toHaveBeenCalled();
  });

  it('rejects an account lookup without billing permission', async () => {
    jest.mocked(AccountQuery.getByNameAsync).mockResolvedValue({
      id: 'viewer-id',
      name: 'viewer',
      viewerUserPermission: { id: 'viewer-permission-id', permissions: [Permission.View] },
    });

    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([]),
        accountName: 'viewer',
        nonInteractive: true,
      })
    ).rejects.toThrow('You must be an Owner or Admin of account "viewer" to manage billing.');
  });

  it('fails when no account has billing permission', async () => {
    await expect(
      resolveBillingAccountAsync({
        graphqlClient,
        actor: actor([account('viewer', Role.ViewOnly)]),
        accountName: undefined,
        nonInteractive: true,
      })
    ).rejects.toThrow('You must be an Owner or Admin of at least one account to manage billing.');
  });
});
