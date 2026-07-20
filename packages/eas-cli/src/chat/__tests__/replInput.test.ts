import { PassThrough } from 'node:stream';

import { createChatReplInput } from '../replInput';

describe(createChatReplInput, () => {
  it('resolves the typed line', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const replInput = createChatReplInput({ input, output, terminal: false });

    const pending = replInput.askAsync('> ');
    input.write('how are my builds?\n');

    expect(await pending).toBe('how are my builds?');
    replInput.close();
  });

  it('reads input even when the stream was left paused (e.g. by a spinner)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const replInput = createChatReplInput({ input, output, terminal: false });
    input.pause();

    const pending = replInput.askAsync('> ');
    input.write('hello\n');

    expect(await pending).toBe('hello');
    replInput.close();
  });

  it('resolves null when the input stream ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const replInput = createChatReplInput({ input, output, terminal: false });

    const pending = replInput.askAsync('> ');
    input.end();

    expect(await pending).toBeNull();
    replInput.close();
  });

  it('resolves null immediately once closed', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const replInput = createChatReplInput({ input, output, terminal: false });
    replInput.close();

    expect(await replInput.askAsync('> ')).toBeNull();
  });
});
