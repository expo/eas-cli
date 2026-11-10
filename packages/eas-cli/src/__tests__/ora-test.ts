import readline from 'readline';
import { Writable } from 'stream';

import type { ora as oraType } from '../ora';

jest.unmock('ora');

const CLEAR_LINE = '\x1b[2K';

// A stream with the parts of tty.WriteStream that ora uses. Like a TTY stream, it implements
// _writev, so Node hands over everything written while corked in one call.
class FakeTTYStream extends Writable {
  isTTY = true;
  columns = 200;
  clearLineCalls = 0;
  writes: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.writes.push(chunk.toString());
    callback();
  }

  override _writev(chunks: { chunk: Buffer }[], callback: () => void): void {
    this.writes.push(chunks.map(({ chunk }) => chunk.toString()).join(''));
    callback();
  }

  clearLine(dir: readline.Direction): boolean {
    this.clearLineCalls++;
    return readline.clearLine(this, dir);
  }

  cursorTo(x: number): boolean {
    return readline.cursorTo(this, x);
  }

  moveCursor(dx: number, dy: number): boolean {
    return readline.moveCursor(this, dx, dy);
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
    const text = 'x'.repeat(150);
    const stream = new FakeTTYStream();
    stream.columns = 80;
    const spinner = ora({
      text,
      stream: stream as unknown as NodeJS.WritableStream,
      discardStdin: false,
    }).start();
    stream.writes = [];

    jest.advanceTimersByTime(500);

    expect(stream.writes.length).toBeGreaterThan(1);
    for (const frame of stream.writes) {
      expect(frame.split(CLEAR_LINE)).toHaveLength(3);
      expect(frame).toContain(text);
    }

    spinner.stop();
  });

  it('clears the spinner and writes the final line as one write', () => {
    const stream = new FakeTTYStream();
    stream.columns = 80;
    const spinner = ora({
      text: 'x'.repeat(150),
      stream: stream as unknown as NodeJS.WritableStream,
      discardStdin: false,
    }).start();
    stream.writes = [];

    spinner.succeed('done');

    expect(stream.writes).toHaveLength(1);
    expect(stream.writes[0].split(CLEAR_LINE)).toHaveLength(3);
    expect(stream.writes[0]).toContain('done');
  });
});
