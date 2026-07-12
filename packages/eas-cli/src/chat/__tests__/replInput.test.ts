import { PassThrough } from 'node:stream';

import { createChatReplInput } from '../replInput';

describe(createChatReplInput, () => {
  it('resolves the typed line', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = createChatReplInput({ input, output, terminal: false });

    const pending = repl.askAsync('> ');
    input.write('how are my builds?\n');

    expect(await pending).toBe('how are my builds?');
    repl.close();
  });

  it('reads input even when the stream was left paused (e.g. by a spinner)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = createChatReplInput({ input, output, terminal: false });
    input.pause();

    const pending = repl.askAsync('> ');
    input.write('hello\n');

    expect(await pending).toBe('hello');
    repl.close();
  });

  it('resolves null when the input stream ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = createChatReplInput({ input, output, terminal: false });

    const pending = repl.askAsync('> ');
    input.end();

    expect(await pending).toBeNull();
    repl.close();
  });

  it('resolves null immediately once closed', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const repl = createChatReplInput({ input, output, terminal: false });
    repl.close();

    expect(await repl.askAsync('> ')).toBeNull();
  });
});
