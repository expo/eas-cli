import type { BuildStepEnv } from '@expo/steps';

import { probeServeSimHelpAsync } from '../deviceSessionHost';

const env = process.env as BuildStepEnv;

describe(probeServeSimHelpAsync, () => {
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
  });
});
