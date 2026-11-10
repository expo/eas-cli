import { EventEmitter } from 'events';

import type { ora as oraType } from '../ora';

jest.unmock('ora');

class FakeTTYStream extends EventEmitter {
  isTTY = true;
  columns = 200;
  clearLineCalls = 0;

  corked = false;
  uncorkedWrites = 0;

  cork(): void {
    this.corked = true;
  }

  uncork(): void {
    this.corked = false;
  }

  write(): boolean {
    if (!this.corked) {
      this.uncorkedWrites++;
    }
    return true;
  }

  clearLine(): boolean {
    this.clearLineCalls++;
    if (!this.corked) {
      this.uncorkedWrites++;
    }
    return true;
  }

  cursorTo(): boolean {
    return true;
  }

  moveCursor(): boolean {
    return true;
  }
}

describe('ora', () => {
  const originalEnv = process.env;
  const originalIsTTY = process.stdin.isTTY;
  let ora: typeof oraType;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.CI;
    delete process.env.EXPO_DEBUG;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true });
    jest.isolateModules(() => {
      ora = require('../ora').ora;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('clears every wrapped line after the terminal gets narrower', () => {
    const stream = new FakeTTYStream();
    const spinner = ora({
      text: 'x'.repeat(150),
      stream: stream as unknown as NodeJS.WritableStream,
      discardStdin: false,
    }).start();

    stream.columns = 80;
    stream.emit('resize');
    spinner.render();

    stream.clearLineCalls = 0;
    spinner.render();
    expect(stream.clearLineCalls).toBe(2);

    spinner.stop();
    expect(stream.listenerCount('resize')).toBe(0);
  });

  it('sends each frame as one write', () => {
    const stream = new FakeTTYStream();
    const spinner = ora({
      text: 'x'.repeat(150),
      stream: stream as unknown as NodeJS.WritableStream,
      discardStdin: false,
    }).start();

    stream.columns = 80;
    stream.emit('resize');
    stream.uncorkedWrites = 0;
    stream.clearLineCalls = 0;

    jest.advanceTimersByTime(500);

    expect(stream.clearLineCalls).toBeGreaterThan(0);
    expect(stream.uncorkedWrites).toBe(0);
    expect(stream.corked).toBe(false);

    spinner.stop();
  });
});
