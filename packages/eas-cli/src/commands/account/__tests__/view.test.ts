import chalk from 'chalk';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { getMockViewerUserPermission } from '../../../__tests__/viewerUserPermission';
import { CommandEvent } from '../../../analytics/AnalyticsManager';
import { Permission, Role } from '../../../graphql/generated';
import Log from '../../../log';
import Sentry from '../../../sentry';
import SessionManager from '../../../user/SessionManager';
import { Actor } from '../../../user/User';
import AccountView from '../view';

const mockLogEvent = jest.fn();

jest.mock('../../../analytics/AnalyticsManager', () => ({
  ...jest.requireActual('../../../analytics/AnalyticsManager'),
  createAnalyticsAsync: jest.fn(async () => ({ logEvent: mockLogEvent })),
}));
jest.mock('../../../sentry');
jest.mock('../../../log');

const ownerPermissions = getMockViewerUserPermission(Role.Owner).permissions;

function account(
  name: string,
  permissions: Permission[],
  effectivePermissions: Permission[] = permissions
): Actor['accounts'][number] {
  return { id: `${name}-id`, name, viewerUserPermission2: { permissions, effectivePermissions } };
}

function personalAccount(
  permissions: Permission[],
  effectivePermissions: Permission[] = permissions
): Actor['accounts'][number] {
  return {
    ...account('jane', permissions, effectivePermissions),
    ownerUserActor: { id: 'user-id', username: 'jane' },
  };
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
  jest.spyOn(SessionManager.prototype, 'getUserAsync').mockResolvedValue(actor);
  const command = new AccountView([], getMockOclifConfig());
  command.id = 'account:view';
  await command.run();
  return jest.mocked(Log.log).mock.calls.map(([message]) => message);
}

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(SessionManager.prototype, 'getAccessToken').mockReturnValue(null);
});

it('does not list accounts when only the unlimited personal account exists', async () => {
  const lines = await runAsync(userActor([personalAccount(ownerPermissions)]));
  expect(lines).toEqual([chalk.green('jane'), 'jane@example.com']);
});

it('lists each account role and attributes the command to the signed-in actor', async () => {
  const lines = await runAsync(
    userActor([
      personalAccount(ownerPermissions),
      account('acme', getMockViewerUserPermission(Role.Developer).permissions),
      account('other', [Permission.Admin, Permission.View]),
    ])
  );
  expect(lines).toContain('• jane (Role: Owner)');
  expect(lines).toContain('• acme (Role: Developer)');
  expect(lines).toContain('• other (Role: Custom: admin, view)');
  expect(SessionManager.prototype.getUserAsync).toHaveBeenCalledTimes(1);
  expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-id', username: 'jane' });
  expect(mockLogEvent).toHaveBeenCalledTimes(1);
  expect(mockLogEvent).toHaveBeenCalledWith(CommandEvent.ACTION, { action: 'eas account:view' });
});

it('lists the personal account when the credentials limit it', async () => {
  const lines = await runAsync(userActor([personalAccount(ownerPermissions, [Permission.View])]));
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
      personalAccount(ownerPermissions),
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
