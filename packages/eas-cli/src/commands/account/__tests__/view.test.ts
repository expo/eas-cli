import chalk from 'chalk';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { getMockViewerUserPermission } from '../../../__tests__/viewerUserPermission';
import { Permission, Role } from '../../../graphql/generated';
import Log from '../../../log';
import { Actor } from '../../../user/User';
import AccountView from '../view';

jest.mock('../../../log');

const ownerPermissions = getMockViewerUserPermission(Role.Owner).permissions;

function account(
  name: string,
  permissions: Permission[],
  effectivePermissions: Permission[] = permissions
): Actor['accounts'][number] {
  return { id: `${name}-id`, name, viewerUserPermission2: { permissions, effectivePermissions } };
}

function userActor(accounts: Actor['accounts']): Actor {
  return {
    __typename: 'User',
    id: 'user-id',
    email: 'jane@example.com',
    username: 'jane',
    accounts,
    isExpoAdmin: false,
    featureGates: {},
  };
}

async function runAsync(actor: Actor): Promise<string[]> {
  const instance = new AccountView([], getMockOclifConfig());
  // @ts-expect-error Mock the protected context without initializing a real session.
  jest.spyOn(instance, 'getContextAsync').mockResolvedValue({
    maybeLoggedIn: { actor, authenticationInfo: { accessToken: null, sessionSecret: 'secret' } },
  });
  await instance.runAsync();
  return jest.mocked(Log.log).mock.calls.map(([message]) => message);
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('does not list accounts when only the unlimited personal account exists', async () => {
  const lines = await runAsync(userActor([account('jane', ownerPermissions)]));
  expect(lines).toEqual([chalk.green('jane'), 'jane@example.com']);
});

it('lists the role on each account', async () => {
  const lines = await runAsync(
    userActor([
      account('jane', ownerPermissions),
      account('acme', getMockViewerUserPermission(Role.Developer).permissions),
      account('other', [Permission.Admin, Permission.View]),
    ])
  );
  expect(lines).toContain('• jane (Role: Owner)');
  expect(lines).toContain('• acme (Role: Developer)');
  expect(lines).toContain('• other (Role: Custom: admin, view)');
});

it('lists the personal account when the credentials limit it', async () => {
  const lines = await runAsync(userActor([account('jane', ownerPermissions, [Permission.View])]));
  expect(lines).toContain(
    `• jane (Role: Owner, ${chalk.yellow('limited to Viewer by the current credentials')})`
  );
  expect(lines).toContain(
    `The permissions granted during authentication limit your access to some accounts. Run ${chalk.bold(
      'eas login'
    )} to change the permission grant.`
  );
});

it('shows the effective permissions when they do not match a role', async () => {
  const lines = await runAsync(
    userActor([
      account('jane', ownerPermissions),
      account('acme', getMockViewerUserPermission(Role.Admin).permissions, [
        Permission.Publish,
        Permission.View,
      ]),
      account('other', getMockViewerUserPermission(Role.Developer).permissions, []),
    ])
  );
  expect(lines).toContain('• jane (Role: Owner)');
  expect(lines).toContain(
    `• acme (Role: Admin, ${chalk.yellow(
      'limited to Custom: publish, view by the current credentials'
    )})`
  );
  expect(lines).toContain(
    `• other (Role: Developer, ${chalk.yellow(
      'limited to No permissions by the current credentials'
    )})`
  );
});
