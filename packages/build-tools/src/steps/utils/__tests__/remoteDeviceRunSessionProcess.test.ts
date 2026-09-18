import type { BuildStepEnv } from '@expo/steps';

import { isProcessRunning, spawnDetached } from '../remoteDeviceRunSession';

jest.mock('@ngrok/ngrok');

it('resolves stopAsync only after a process that ignores SIGTERM is gone', async () => {
  const handle = spawnDetached({
    command: 'sh',
    args: ['-c', 'trap "" TERM; echo ready; sleep 30 & wait'],
    env: process.env as BuildStepEnv,
    stopGracePeriodMs: 300,
  });
  const pid = handle.pid;
  if (pid === undefined) {
    throw new Error('spawn failed');
  }
  while (!handle.getOutput().includes('ready')) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const startedAt = Date.now();
  await handle.stopAsync();
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
  expect(isProcessRunning(pid)).toBe(false);
});
