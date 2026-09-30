jest.unmock('node:fs/promises');

import { ShellSessionManager } from '../shellSessionManager';
import * as processes from '../../../utils/processes';

describe('ShellSessionManager', () => {
  it.each([false, true])('uses only the supplied environment (tty: %s)', async tty => {
    const controller = new AbortController();
    const previous = process.env.SANDBOX_WORKER_ONLY;
    process.env.SANDBOX_WORKER_ONLY = 'worker-secret';
    const manager = new ShellSessionManager({
      workingDirectory: process.cwd(),
      env: { SHELL: '/bin/sh', SANDBOX_PREPARED: 'prepared-value' },
      signal: controller.signal,
    });
    try {
      const sessionId = await manager.startAsync({
        cmd: 'printf "%s:%s" "$SANDBOX_PREPARED" "${SANDBOX_WORKER_ONLY-unset}"',
        tty,
      });
      expect(await manager.readAsync(sessionId, 10_000)).toEqual({
        output: 'prepared-value:unset',
        exitCode: 0,
      });
    } finally {
      controller.abort();
      await manager.stoppedPromise;
      if (previous === undefined) {
        delete process.env.SANDBOX_WORKER_ONLY;
      } else {
        process.env.SANDBOX_WORKER_ONLY = previous;
      }
    }
  });

  it.each([false, true])('does not signal an exited leader (tty: %s)', async tty => {
    const controller = new AbortController();
    const manager = new ShellSessionManager({
      workingDirectory: process.cwd(),
      env: process.env,
      signal: controller.signal,
    });
    const kill = jest.spyOn(processes, 'killProcessGroup');
    try {
      const sessionId = await manager.startAsync({ cmd: 'exit 0', tty });
      expect(await manager.readAsync(sessionId, 10_000)).toMatchObject({ exitCode: 0 });
      controller.abort();
      await manager.stoppedPromise;
      expect(kill).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      await manager.stoppedPromise;
      kill.mockRestore();
    }
  });

  it('keeps completed sessions without repeating their output', async () => {
    const controller = new AbortController();
    const manager = new ShellSessionManager({
      workingDirectory: process.cwd(),
      env: process.env,
      signal: controller.signal,
    });
    try {
      const sessionId = await manager.startAsync({ cmd: 'printf hello' });
      expect(await manager.readAsync(sessionId, 1_000)).toEqual({ output: 'hello', exitCode: 0 });
      expect(await manager.readAsync(sessionId, 1_000)).toEqual({ output: '', exitCode: 0 });
    } finally {
      controller.abort();
      await manager.stoppedPromise;
    }
  });

  it('keeps sessions separate and stops only its own manager', async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = new ShellSessionManager({
      workingDirectory: process.cwd(),
      env: process.env,
      signal: firstController.signal,
    });
    const second = new ShellSessionManager({
      workingDirectory: process.cwd(),
      env: process.env,
      signal: secondController.signal,
    });
    try {
      const firstId = await first.startAsync({ cmd: 'printf first' });
      const secondId = await second.startAsync({ cmd: 'read value; printf "%s" "$value"' });
      expect(await first.readAsync(firstId, 1_000)).toEqual({ output: 'first', exitCode: 0 });
      firstController.abort();
      await first.stoppedPromise;
      await expect(first.startAsync({ cmd: 'printf stopped' })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(await second.readAsync(secondId, 0)).toEqual({ output: '', sessionId: secondId });
      second.write(secondId, 'second\n');
      expect(await second.readAsync(secondId, 1_000)).toEqual({ output: 'second', exitCode: 0 });
    } finally {
      firstController.abort();
      secondController.abort();
      await Promise.all([first.stoppedPromise, second.stoppedPromise]);
    }
  });
});
