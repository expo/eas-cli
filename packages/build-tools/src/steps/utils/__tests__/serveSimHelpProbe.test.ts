import type { BuildStepEnv } from '@expo/steps';

import { isProcessGroupRunning } from '../../../utils/processes';
import { probeServeSimHelpAsync } from '../deviceSessionHost';
import * as remoteDeviceRunSession from '../remoteDeviceRunSession';

const env = process.env as BuildStepEnv;

describe(probeServeSimHelpAsync, () => {
  let probes: remoteDeviceRunSession.DetachedProcessHandle[];

  beforeEach(() => {
    probes = [];
    const spawnDetached = remoteDeviceRunSession.spawnDetached;
    jest.spyOn(remoteDeviceRunSession, 'spawnDetached').mockImplementation(options => {
      const probe = spawnDetached(options);
      probes.push(probe);
      return probe;
    });
  });

  afterEach(async () => {
    try {
      await Promise.all(probes.map(probe => probe.stopAsync()));
    } finally {
      jest.restoreAllMocks();
    }
  });

  async function expectProbeStoppedAsync(): Promise<void> {
    expect(probes).toHaveLength(1);
    const pid = probes[0].pid;
    if (pid === undefined) {
      throw new Error('Probe process did not start.');
    }
    const deadline = Date.now() + 2_000;
    while (isProcessGroupRunning(pid) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(isProcessGroupRunning(pid)).toBe(false);
  }

  it('detects support from a real help process that prints the flag and exits', async () => {
    expect(
      await probeServeSimHelpAsync({
        command: process.execPath,
        args: ['-e', "process.stdout.write('--disable-share\\n', () => process.exit(0));"],
        env,
        timeoutMs: 5_000,
      })
    ).toBe(true);
    await expectProbeStoppedAsync();
  });

  it('returns when the launcher exits even if a descendant retains its output pipes', async () => {
    const script = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.unref();
      process.stdout.write('--share-url\\n', () => process.exit(0));
    `;
    const startedAt = Date.now();
    expect(
      await probeServeSimHelpAsync({
        command: process.execPath,
        args: ['-e', script],
        env,
        timeoutMs: 5_000,
      })
    ).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2_500);
    await expectProbeStoppedAsync();
  });

  it('returns after its deadline when the process ignores SIGTERM', async () => {
    const script = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
    const startedAt = Date.now();

    expect(
      await probeServeSimHelpAsync({
        command: process.execPath,
        args: ['-e', script],
        env,
        timeoutMs: 300,
      })
    ).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await expectProbeStoppedAsync();
  });
});
