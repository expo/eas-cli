import { PassThrough } from 'node:stream';

import { ControlPromptCancelledError, promptControlValueAsync } from '../controlPrompts';

jest.unmock('prompts');

function terminal(): {
  input: PassThrough & { isTTY: boolean; setRawMode: jest.Mock };
  output: PassThrough & { columns: number };
} {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: jest.fn() });
  const output = Object.assign(new PassThrough(), { columns: 80 });
  output.resume();
  return { input, output };
}

describe('abortable simulator control prompts', () => {
  it('aborts the real idle prompt and restores the terminal', async () => {
    const { input, output } = terminal();
    const controller = new AbortController();
    const reason = new Error('Connection lost');
    const result = promptControlValueAsync(
      { type: 'text', message: 'Value', stdin: input, stdout: output },
      controller.signal
    );
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(input.listenerCount('keypress')).toBe(0);
  });

  it('handles cancellation during the first constructor render', async () => {
    const { input, output } = terminal();
    const controller = new AbortController();
    const reason = new Error('Session ended');
    await expect(
      promptControlValueAsync(
        {
          type: 'select',
          message: 'Action',
          choices: [{ title: 'Exit', value: null }],
          stdin: input,
          stdout: output,
          onRender() {
            controller.abort(reason);
          },
        },
        controller.signal
      )
    ).rejects.toBe(reason);
    expect(input.listenerCount('keypress')).toBe(0);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('never opens a prompt for an already lost connection', async () => {
    const { input, output } = terminal();
    const signal = AbortSignal.abort(new Error('Already closed'));
    await expect(
      promptControlValueAsync(
        { type: 'text', message: 'Value', stdin: input, stdout: output },
        signal
      )
    ).rejects.toThrow('Already closed');
    expect(input.setRawMode).not.toHaveBeenCalled();
  });

  it('unwinds Ctrl-C instead of exiting the process', async () => {
    const { input, output } = terminal();
    const result = promptControlValueAsync(
      { type: 'text', message: 'Value', stdin: input, stdout: output },
      new AbortController().signal
    );
    input.write('\u0003');
    await expect(result).rejects.toBeInstanceOf(ControlPromptCancelledError);
    expect(input.listenerCount('keypress')).toBe(0);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('preserves an explicitly empty string', async () => {
    const { input, output } = terminal();
    const result = promptControlValueAsync(
      { type: 'text', message: 'Value', stdin: input, stdout: output },
      new AbortController().signal
    );
    input.write('\r');
    await expect(result).resolves.toBe('');
    expect(input.listenerCount('keypress')).toBe(0);
  });
});
