import fs from 'node:fs/promises';

import { createColdIosSessionAsync } from '../coldIosSession';
import { spawnDetached } from '../remoteDeviceRunSession';

jest.mock('../remoteDeviceRunSession', () => ({
  fetchWebPreviewTurnArgsAsync: jest.fn(async () => []),
  findAvailablePortAsync: jest.fn(async () => 3200),
  spawnDetached: jest.fn(() => ({ stopAsync: jest.fn() })),
}));

const STATE_FILE = '/tmp/expo-simulator-startup.json';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const logger = { info: jest.fn(), warn: jest.fn() } as any;

async function startServerAsync(signal?: AbortSignal) {
  const server = await createColdIosSessionAsync({} as any, { env: {}, logger });
  return await server.startAsync({
    command: 'serve-sim',
    args: [],
    env: {},
    logger,
    secrets: [],
    stopGracePeriodMs: 1000,
    signal,
  });
}

beforeEach(async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  await fs.mkdir('/tmp', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify({ status: 'stopping' }));
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
});

it('starts serve-sim only after warm Simulator cleanup finished', async () => {
  const starting = startServerAsync();
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(spawnDetached).not.toHaveBeenCalled();
  await fs.writeFile(STATE_FILE, JSON.stringify({ status: 'disabled' }));
  await starting;
  expect(spawnDetached).toHaveBeenCalledTimes(1);
});

it('does not start serve-sim when the job is cancelled while cleanup runs', async () => {
  const controller = new AbortController();
  const starting = startServerAsync(controller.signal);
  // Cleanup is still running; the cancellation alone must end the wait.
  controller.abort(new Error('cancelled'));
  await expect(starting).rejects.toThrow('cancelled');
  expect(spawnDetached).not.toHaveBeenCalled();
});
