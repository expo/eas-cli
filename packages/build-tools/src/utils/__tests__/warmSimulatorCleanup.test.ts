import fs from 'node:fs/promises';

import { waitForWarmSimulatorCleanupAsync } from '../warmSimulatorCleanup';

const STATE_FILE = '/tmp/expo-simulator-startup.json';
const STARTUP_SCRIPT = '/usr/local/share/vm-tools/startup.sh';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

async function writeStateAsync(state: object): Promise<void> {
  await fs.mkdir('/tmp', { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state));
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
});

it('continues at once on a VM without warmup', async () => {
  await expect(waitForWarmSimulatorCleanupAsync({})).resolves.toBeUndefined();
});

it('waits for cleanup when warmup is installed but has not written state yet', async () => {
  await fs.mkdir('/usr/local/share/vm-tools', { recursive: true });
  await fs.writeFile(STARTUP_SCRIPT, '');
  let finished = false;
  const waiting = waitForWarmSimulatorCleanupAsync({}, { pollMs: 5 }).then(() => {
    finished = true;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(finished).toBe(false);
  await writeStateAsync({ status: 'starting' });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(finished).toBe(false);
  await writeStateAsync({ status: 'disabled' });
  await waiting;
});

it('times out when installed warmup never writes state', async () => {
  await fs.mkdir('/usr/local/share/vm-tools', { recursive: true });
  await fs.writeFile(STARTUP_SCRIPT, '');
  await expect(waitForWarmSimulatorCleanupAsync({}, { timeoutMs: 20, pollMs: 5 })).rejects.toThrow(
    'Warm Simulator cleanup did not finish; the Simulator cannot be used.'
  );
});

it('waits until the launcher records that cleanup finished', async () => {
  await writeStateAsync({ status: 'ready' });
  let finished = false;
  const waiting = waitForWarmSimulatorCleanupAsync({}, { pollMs: 5 }).then(() => {
    finished = true;
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(finished).toBe(false);
  await writeStateAsync({ status: 'stopping' });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(finished).toBe(false);
  await writeStateAsync({ status: 'disabled' });
  await waiting;
  expect(finished).toBe(true);
});

it('fails with the recorded error when cleanup does not finish in time', async () => {
  await writeStateAsync({ status: 'stopping', error: 'serve-sim did not exit' });
  await expect(waitForWarmSimulatorCleanupAsync({}, { timeoutMs: 20, pollMs: 5 })).rejects.toThrow(
    'Warm Simulator cleanup did not finish (serve-sim did not exit); the Simulator cannot be used.'
  );
});

it('stops waiting when the job is cancelled', async () => {
  await writeStateAsync({ status: 'stopping' });
  const controller = new AbortController();
  const waiting = waitForWarmSimulatorCleanupAsync({}, { pollMs: 5, signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await expect(waiting).rejects.toThrow('cancelled');
});

it('does not wait for a job that uses the warm Simulator', async () => {
  await writeStateAsync({ status: 'claimed' });
  await expect(
    waitForWarmSimulatorCleanupAsync({ EAS_USE_WARM_SIMULATOR: '1' }, { timeoutMs: 0 })
  ).resolves.toBeUndefined();
});

it('does nothing outside macOS', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  await writeStateAsync({ status: 'ready' });
  await expect(waitForWarmSimulatorCleanupAsync({}, { timeoutMs: 0 })).resolves.toBeUndefined();
});
