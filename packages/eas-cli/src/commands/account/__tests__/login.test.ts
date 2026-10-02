import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import Log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import SessionManager from '../../../user/SessionManager';
import { resumeDeviceLoginAsync, startDeviceLoginAsync } from '../../../user/deviceLogin';
import AccountLogin from '../login';

jest.mock('../../../prompts');
jest.mock('../../../log');
jest.mock('../../../user/deviceLogin', () => ({
  ...jest.requireActual('../../../user/deviceLogin'),
  startDeviceLoginAsync: jest.fn(),
  resumeDeviceLoginAsync: jest.fn(),
}));

const pending = {
  request_id: 'request-id',
  status: 'authorization_pending',
  verification_uri: 'https://expo.dev/oauth/device',
  verification_uri_complete: 'https://expo.dev/oauth/device?user_code=BCDF-GHJK',
  user_code: 'BCDF-GHJK',
  expires_at: '2026-10-01T00:00:00Z',
  retry_after: 5,
} satisfies Awaited<ReturnType<typeof startDeviceLoginAsync>>;

const resumeCommand = `eas login --device --non-interactive --resume ${pending.request_id}`;
const sessionManager = new SessionManager({
  logEvent: jest.fn(),
  setActor: jest.fn(),
  flushAsync: jest.fn(),
});
const originalIsTTY = process.stdin.isTTY;
const originalCI = process.env.CI;

function command(args: string[]): AccountLogin {
  const instance = new AccountLogin(['--device', ...args], getMockOclifConfig());
  // @ts-expect-error Mock the protected context without initializing a real session.
  jest.spyOn(instance, 'getContextAsync').mockResolvedValue({
    sessionManager,
    maybeLoggedIn: { actor: null },
  });
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.stdin.isTTY = false;
  delete process.env.CI;
  jest.spyOn(sessionManager, 'getAccessToken').mockReturnValue(null);
  jest.spyOn(global, 'setTimeout');
});

afterEach(() => {
  try {
    expect(confirmAsync).not.toHaveBeenCalled();
    expect(promptAsync).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
  } finally {
    process.stdin.isTTY = originalIsTTY;
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
    jest.restoreAllMocks();
  }
});

it('starts once with closed stdin and gives the agent a matching resume command', async () => {
  jest.mocked(startDeviceLoginAsync).mockResolvedValue(pending);
  await command([]).runAsync();
  expect(Log.log).toHaveBeenCalledWith(`Open ${pending.verification_uri_complete}`);
  expect(Log.log).toHaveBeenCalledWith(`Code: ${pending.user_code}`);
  expect(Log.log).toHaveBeenCalledWith(
    'Ask the user to approve the login and send you the number shown in their browser.'
  );
  expect(Log.log).toHaveBeenCalledWith(
    `After they reply, run: ${resumeCommand} --match NUMBER_FROM_USER`
  );
  expect(startDeviceLoginAsync).toHaveBeenCalledTimes(1);
  expect(resumeDeviceLoginAsync).not.toHaveBeenCalled();
});

it.each([
  ['--non-interactive', undefined],
  [undefined, '1'],
] as const)('runs one step with flag %s and CI=%s in a TTY', async (flag, ci) => {
  process.stdin.isTTY = true;
  if (ci) {
    process.env.CI = ci;
  }
  jest.mocked(startDeviceLoginAsync).mockResolvedValue(pending);
  await command(flag ? [flag] : []).runAsync();
  expect(startDeviceLoginAsync).toHaveBeenCalledTimes(1);
  expect(Log.log).toHaveBeenCalledWith(
    'Ask the user to approve the login and send you the number shown in their browser.'
  );
  expect(Log.log).toHaveBeenCalledWith(
    `After they reply, run: ${resumeCommand} --match NUMBER_FROM_USER`
  );
});

it('reports pending approval and when to retry', async () => {
  jest.mocked(resumeDeviceLoginAsync).mockResolvedValue(pending);
  await command(['--resume', pending.request_id]).runAsync();
  expect(resumeDeviceLoginAsync).toHaveBeenCalledTimes(1);
  expect(resumeDeviceLoginAsync).toHaveBeenCalledWith(
    pending.request_id,
    sessionManager,
    undefined
  );
  expect(Log.log).toHaveBeenCalledWith('Approval pending. Retry after 5 seconds:');
  expect(Log.log).toHaveBeenCalledWith(resumeCommand);
});

it('requests the browser number when matching is required', async () => {
  jest.mocked(resumeDeviceLoginAsync).mockResolvedValue({
    ...pending,
    status: 'matching_required',
    match_options: ['12', '42', '87'],
  });
  await command(['--resume', pending.request_id]).runAsync();
  expect(Log.log).toHaveBeenCalledWith(
    'Ask the user for the number shown in their browser, then run:'
  );
  expect(Log.log).toHaveBeenCalledWith(`${resumeCommand} --match NUMBER_FROM_USER`);
  expect(resumeDeviceLoginAsync).toHaveBeenCalledTimes(1);
});

it('preserves the supplied number when matching must be retried', async () => {
  jest.mocked(resumeDeviceLoginAsync).mockResolvedValue({
    ...pending,
    status: 'slow_down',
    retry_after: 10,
  });
  await command(['--resume', pending.request_id, '--match', '42']).runAsync();
  expect(resumeDeviceLoginAsync).toHaveBeenCalledWith(pending.request_id, sessionManager, '42');
  expect(Log.log).toHaveBeenCalledWith('Approval pending. Retry after 10 seconds:');
  expect(Log.log).toHaveBeenCalledWith(`${resumeCommand} --match 42`);
});

it('authenticates on the first resume when given the browser number', async () => {
  jest.mocked(resumeDeviceLoginAsync).mockResolvedValue({
    request_id: pending.request_id,
    status: 'authenticated',
    username: 'demo-user',
  });
  await command(['--resume', pending.request_id, '--match', '42']).runAsync();
  expect(Log.log).toHaveBeenCalledWith('Logged in as demo-user');
  expect(resumeDeviceLoginAsync).toHaveBeenCalledTimes(1);
});

it.each(['access_denied', 'expired_token', 'invalid_grant'] as const)(
  'fails on %s without retrying',
  async status => {
    jest
      .mocked(resumeDeviceLoginAsync)
      .mockResolvedValue({ request_id: pending.request_id, status });
    await expect(command(['--resume', pending.request_id]).runAsync()).rejects.toThrow(
      `Device login failed (${status}). Start again with eas login --device.`
    );
    expect(resumeDeviceLoginAsync).toHaveBeenCalledTimes(1);
  }
);

it('rejects the removed JSON flag', async () => {
  await expect(command(['--json']).runAsync()).rejects.toThrow();
  expect(startDeviceLoginAsync).not.toHaveBeenCalled();
});

it('requires device login for non-interactive sign-in', async () => {
  const instance = new AccountLogin(['--non-interactive'], getMockOclifConfig());
  await expect(instance.runAsync()).rejects.toThrow(
    'Use eas login --device --non-interactive to log in without prompts.'
  );
});
