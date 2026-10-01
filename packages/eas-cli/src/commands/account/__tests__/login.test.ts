import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { confirmAsync, promptAsync } from '../../../prompts';
import SessionManager from '../../../user/SessionManager';
import {
  DeviceLoginResult,
  resumeDeviceLoginAsync,
  startDeviceLoginAsync,
} from '../../../user/deviceLogin';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import AccountLogin from '../login';

jest.mock('../../../prompts');
jest.mock('../../../log');
jest.mock('../../../utils/json');
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

const sessionManager = new SessionManager({
  logEvent: jest.fn(),
  setActor: jest.fn(),
  flushAsync: jest.fn(),
});
const originalIsTTY = process.stdin.isTTY;

function command(args: string[]): AccountLogin {
  const instance = new AccountLogin(['--device', '--json', ...args], getMockOclifConfig());
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
    jest.restoreAllMocks();
  }
});

it('starts a JSON login with closed stdin and returns without polling', async () => {
  jest.mocked(startDeviceLoginAsync).mockResolvedValue(pending);
  await command([]).runAsync();
  expect(enableJsonOutput).toHaveBeenCalledTimes(1);
  expect(printJsonOnlyOutput).toHaveBeenCalledWith(pending);
  expect(startDeviceLoginAsync).toHaveBeenCalledTimes(1);
  expect(resumeDeviceLoginAsync).not.toHaveBeenCalled();
});

it.each([
  pending,
  { ...pending, status: 'matching_required', match_options: ['12', '42', '87'] },
  { ...pending, status: 'slow_down', retry_after: 10 },
  { request_id: pending.request_id, status: 'authenticated', username: 'demo-user' },
] satisfies DeviceLoginResult[])(
  'returns $status after exactly one JSON resume step',
  async result => {
    jest.mocked(resumeDeviceLoginAsync).mockResolvedValue(result);
    await command(['--resume', pending.request_id, '--match', '42']).runAsync();
    expect(startDeviceLoginAsync).not.toHaveBeenCalled();
    expect(resumeDeviceLoginAsync).toHaveBeenCalledTimes(1);
    expect(resumeDeviceLoginAsync).toHaveBeenCalledWith(pending.request_id, sessionManager, '42');
    expect(printJsonOnlyOutput).toHaveBeenCalledWith(result);
  }
);

it.each(['access_denied', 'expired_token', 'invalid_grant'] as const)(
  'prints %s and exits unsuccessfully without retrying',
  async status => {
    const result = { request_id: pending.request_id, status };
    jest.mocked(resumeDeviceLoginAsync).mockResolvedValue(result);
    const instance = command(['--resume', pending.request_id]);
    const exit = jest.spyOn(instance, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    await expect(instance.runAsync()).rejects.toThrow('exit');
    expect(printJsonOnlyOutput).toHaveBeenCalledWith(result);
    expect(exit).toHaveBeenCalledWith(1);
    expect(resumeDeviceLoginAsync).toHaveBeenCalledTimes(1);
  }
);
