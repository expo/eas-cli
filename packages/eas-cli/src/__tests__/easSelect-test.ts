import { PassThrough } from 'stream';

import EasSelect, { SelectChoice } from '../easSelect';

function createPromptWithOutput(
  choices: SelectChoice[],
  initial?: number
): { prompt: EasSelect; output: () => string } {
  let written = '';
  const prompt = new EasSelect({
    type: 'select',
    name: 'value',
    message: 'Pick one',
    initial,
    choices,
    stdin: new PassThrough(),
    stdout: {
      write: (chunk: string) => {
        written += chunk;
        return true;
      },
      columns: 200,
      rows: 24,
    } as any,
  });
  return { prompt, output: () => written };
}

function createPrompt(warn?: string): EasSelect {
  return new EasSelect({
    type: 'select',
    name: 'value',
    message: 'Pick one',
    warn,
    choices: [
      { title: 'enabled', value: 'enabled' },
      { title: 'disabled', value: 'disabled', disabled: true },
      { title: 'with-reason', value: 'with-reason', disabled: true, disabledReason: 'No access' },
    ],
    stdin: new PassThrough(),
    // Render into a stream that drops the output.
    stdout: { write: () => true, columns: 80, rows: 24 } as any,
  });
}

describe(EasSelect, () => {
  it('shows the reason of the highlighted disabled choice', () => {
    const prompt = createPrompt('- Default warning');
    prompt.cursor = 2;
    expect(prompt.warn).toBe('- No access');
  });

  it('falls back to warn for a disabled choice without a reason', () => {
    const prompt = createPrompt('- Default warning');
    prompt.cursor = 1;
    expect(prompt.warn).toBe('- Default warning');
  });

  it('falls back to the prompts default warning when warn is not set', () => {
    const prompt = createPrompt();
    prompt.cursor = 1;
    expect(prompt.warn).toBe('- This option is disabled');
  });

  it('shows the reason of the initially highlighted disabled choice on the first render', () => {
    const { prompt, output } = createPromptWithOutput([
      { title: 'first', value: 'first', disabled: true, disabledReason: 'No access to first' },
      { title: 'second', value: 'second', disabled: true, disabledReason: 'No access to second' },
    ]);
    expect(prompt.cursor).toBe(0);
    expect(output()).toContain('- No access to first');
  });

  it('starts on the first enabled choice when the initial choice is disabled', () => {
    const { prompt, output } = createPromptWithOutput([
      { title: 'first', value: 'first', disabled: true, disabledReason: 'No access' },
      { title: 'second', value: 'second' },
    ]);
    expect(prompt.cursor).toBe(1);
    expect(prompt.value).toBe('second');
    expect(output()).toContain('Use arrow-keys');
  });

  it('keeps an enabled initial choice', () => {
    const { prompt } = createPromptWithOutput(
      [
        { title: 'first', value: 'first' },
        { title: 'second', value: 'second' },
      ],
      1
    );
    expect(prompt.cursor).toBe(1);
  });

  it('keeps the SelectPrompt name so that prompts enables j/k navigation', () => {
    expect(EasSelect.name).toBe('SelectPrompt');
  });
});
