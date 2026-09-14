jest.unmock('node:fs/promises');

import { ShellSessionManager } from '../shellSessionManager';

describe('ShellSessionManager', () => {
  it('keeps completed sessions without repeating their output', async () => {
    const controller = new AbortController();
    const manager = new ShellSessionManager({
      workingDirectory: process.cwd(),
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
      signal: firstController.signal,
    });
    const second = new ShellSessionManager({
      workingDirectory: process.cwd(),
      signal: secondController.signal,
    });
    try {
      const firstId = await first.startAsync({ cmd: 'printf first' });
      const secondId = await second.startAsync({ cmd: 'printf second' });
      expect(await first.readAsync(firstId, 1_000)).toEqual({ output: 'first', exitCode: 0 });
      firstController.abort();
      await first.stoppedPromise;
      await expect(first.startAsync({ cmd: 'printf stopped' })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(await second.readAsync(secondId, 1_000)).toEqual({ output: 'second', exitCode: 0 });
    } finally {
      firstController.abort();
      secondController.abort();
      await Promise.all([first.stoppedPromise, second.stoppedPromise]);
    }
  });
});
