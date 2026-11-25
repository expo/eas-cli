import { CombinedError } from '@urql/core';
import chalk from 'chalk';

import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { getMockViewerUserPermission } from '../../../__tests__/viewerUserPermission';
import { CommandEvent } from '../../../analytics/AnalyticsManager';
import { Permission, Role } from '../../../graphql/generated';
import Log from '../../../log';
import Sentry from '../../../sentry';
import SessionManager from '../../../user/SessionManager';
import { Actor } from '../../../user/User';
import { printJsonOnlyOutput } from '../../../utils/json';
import AccountView from '../view';

const mockLogEvent = jest.fn();

jest.mock('../../../analytics/AnalyticsManager', () => ({
  ...jest.requireActual('../../../analytics/AnalyticsManager'),
  createAnalyticsAsync: jest.fn(async () => ({ logEvent: mockLogEvent, flushAsync: jest.fn() })),
}));
jest.mock('../../../sentry');
jest.mock('../../../log');
jest.mock('../../../utils/json');

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
  jest.replaceProperty(process, 'env', { ...process.env, EXPO_TOKEN: '' });
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

it('identifies the actor independently of their first account', async () => {
  const actor = userActor([account('acme', ownerPermissions), personalAccount(ownerPermissions)]);
  jest.spyOn(SessionManager.prototype, 'getUserAsync').mockResolvedValue(actor);
  await AccountView.run(['--non-interactive', '--json'], getMockOclifConfig());
  expect(printJsonOnlyOutput).toHaveBeenCalledWith({
    status: 'signed-in',
    actor: { id: 'user-id', type: 'User', displayName: 'jane' },
    accounts: [{ name: 'acme' }, { name: 'jane' }],
  });
  expect(Log.log).not.toHaveBeenCalled();
});

const authError = { message: 'Rejected credential', code: 'AUTHENTICATION_ERROR' };
const permissionError = { message: 'Permission denied', code: 'UNAUTHORIZED_ERROR' };

it.each([
  [
    new CombinedError({ networkError: new Error('HTTP 401'), graphQLErrors: [authError] }),
    'HTTP 401',
  ],
  [new CombinedError({ graphQLErrors: [permissionError] }), 'Permission denied'],
  [new CombinedError({ graphQLErrors: [authError, permissionError] }), 'Permission denied'],
  [
    new CombinedError({ graphQLErrors: ['The bearer token is invalid.'] }),
    'The bearer token is invalid.',
  ],
  [undefined, 'The server returned no actor for EXPO_TOKEN.'],
] as const)(
  'reports an indeterminate lookup and preserves its diagnostic: %s',
  async (error, diagnostic) => {
    process.env.EXPO_TOKEN = 'fixture-token';
    const lookup = jest.spyOn(SessionManager.prototype, 'getUserAsync');
    if (error) {
      lookup.mockRejectedValue(error);
    } else {
      lookup.mockResolvedValue(undefined);
    }
    await expect(AccountView.run(['--json'], getMockOclifConfig())).rejects.toThrow();
    expect(printJsonOnlyOutput).toHaveBeenCalledTimes(1);
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ status: 'indeterminate' });
    expect(Log.errorToStderr).toHaveBeenCalledWith(expect.stringContaining(diagnostic));
  }
);

it('keeps the argument diagnostic when startup has not initialized analytics', async () => {
  await expect(AccountView.run(['--json', '--bogus'], getMockOclifConfig())).rejects.toThrow(
    'command failed'
  );
  expect(Log.errorToStderr).toHaveBeenCalledWith(
    expect.stringContaining('Nonexistent flag: --bogus')
  );
  expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  expect(Sentry.flush).toHaveBeenCalled();
});

it('records an anonymous action when signed out', async () => {
  const originalExitCode = process.exitCode;
  jest.spyOn(SessionManager.prototype, 'getUserAsync').mockResolvedValue(undefined);
  try {
    await AccountView.run(['--non-interactive', '--json'], getMockOclifConfig());
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({ status: 'signed-out' });
    expect(process.exitCode).toBe(1);
    expect(Sentry.setUser).not.toHaveBeenCalled();
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

it.each(['The bearer token is invalid.', 'The bearer token is revoked.'])(
  'reports explicit token rejection: %s',
  async message => {
    const originalExitCode = process.exitCode;
    process.env.EXPO_TOKEN = 'fixture-token';
    const lookup = jest
      .spyOn(SessionManager.prototype, 'getUserAsync')
      .mockRejectedValue(new CombinedError({ graphQLErrors: [{ ...authError, message }] }));
    try {
      await AccountView.run(['--json'], getMockOclifConfig());
      expect(process.exitCode).toBe(1);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(printJsonOnlyOutput).toHaveBeenCalledTimes(1);
      expect(printJsonOnlyOutput).toHaveBeenCalledWith({ status: 'token-rejected' });
      expect(mockLogEvent).not.toHaveBeenCalled();
    } finally {
      process.exitCode = originalExitCode;
    }
  }
);
