import { PassThrough } from 'node:stream';

import Log from '../../log';
import { promptControlActionAsync, runControlMenuAsync } from '../controlInteractive';
import { ControlPromptCancelledError, promptControlValueAsync } from '../controlPrompts';
import { HostActionCatalog } from '../hostActions';

jest.mock('../controlPrompts', () => ({
  ...jest.requireActual('../controlPrompts'),
  promptControlValueAsync: jest.fn(),
}));
jest.mock('../../log');
jest.unmock('prompts');

const prompt = jest.mocked(promptControlValueAsync);
const catalog: HostActionCatalog = require('./fixtures/hostActionCatalog.json');
const signal = new AbortController().signal;

function useTerminalPrompts(): { enterAsync(value: string): Promise<void>; output(): string } {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: jest.fn() });
  const output = Object.assign(new PassThrough(), { columns: 80 });
  let text = '';
  output.on('data', chunk => {
    text += String(chunk);
  });
  const actual = jest.requireActual<typeof import('../controlPrompts')>('../controlPrompts');
  prompt.mockImplementation(
    async (question, signal) =>
      await actual.promptControlValueAsync({ ...question, stdin: input, stdout: output }, signal)
  );
  return {
    async enterAsync(value) {
      input.write(`\u0007${value}\r`);
      await new Promise(resolve => setImmediate(resolve));
    },
    output: () => text,
  };
}

describe('catalog-driven control prompts', () => {
  beforeEach(() => jest.resetAllMocks());

  it('asks for enum values without hardcoding the action name', async () => {
    prompt.mockResolvedValueOnce('off');
    await expect(
      promptControlActionAsync('future.toggle', catalog['hardwareKeyboard.set'], signal)
    ).resolves.toEqual({ action: 'future.toggle', params: { value: 'off' } });
    expect(prompt.mock.calls[0][0]).toMatchObject({
      type: 'select',
      choices: [
        { title: 'on', value: 'on' },
        { title: 'off', value: 'off' },
      ],
    });
  });

  it('uses the exposed path branch instead of asking for an upload ID', async () => {
    prompt.mockResolvedValueOnce('./My App.ipa');
    await expect(
      promptControlActionAsync('app.install', catalog['app.install'], signal)
    ).resolves.toEqual({ action: 'app.install', params: { path: './My App.ipa' } });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('selects a discriminator branch and omits other branch fields', async () => {
    prompt.mockResolvedValueOnce('placeholder');
    await expect(
      promptControlActionAsync('camera.switch', catalog['camera.switch'], signal)
    ).resolves.toEqual({ action: 'camera.switch', params: { source: 'placeholder' } });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('leaves optional values omitted and preserves explicitly empty strings', async () => {
    const entry = {
      type: 'object',
      properties: { text: { type: 'string', default: 'server default' } },
    };
    prompt.mockResolvedValueOnce(false);
    await expect(promptControlActionAsync('clipboard.paste', entry, signal)).resolves.toEqual({
      action: 'clipboard.paste',
      params: {},
    });
    prompt.mockResolvedValueOnce(true).mockResolvedValueOnce('');
    await expect(promptControlActionAsync('clipboard.paste', entry, signal)).resolves.toEqual({
      action: 'clipboard.paste',
      params: { text: '' },
    });
  });

  it('reads array values as JSON and prompts for file output before execution', async () => {
    const entry = {
      type: 'object',
      properties: { events: { type: 'array', items: { type: 'object' } } },
      required: ['events'],
      output: 'base64' as const,
    };
    prompt.mockResolvedValueOnce('[{"type":"begin"}]').mockResolvedValueOnce('./output.png');
    await expect(promptControlActionAsync('future.gesture', entry, signal)).resolves.toEqual({
      action: 'future.gesture',
      params: { events: [{ type: 'begin' }] },
      outputPath: './output.png',
    });
  });

  it('falls back to a JSON object when branches cannot be selected safely', async () => {
    const entry = {
      anyOf: [
        { properties: { a: { type: 'string' } }, required: ['a'] },
        { properties: { b: { type: 'string' } }, required: ['b'] },
      ],
    };
    prompt.mockResolvedValueOnce('{"b":"value"}');
    await expect(promptControlActionAsync('future.union', entry, signal)).resolves.toEqual({
      action: 'future.union',
      params: { b: 'value' },
    });
    expect(prompt.mock.calls[0][0].message).toContain('JSON');
  });

  it.each([
    [{ anyOf: [{ type: 'boolean' }, { type: 'null' }] }, 'false', false],
    [{ anyOf: [{ type: 'boolean' }, { type: 'null' }] }, 'null', null],
    [{ anyOf: [{ type: 'string' }, { type: 'object' }] }, '"hello"', 'hello'],
  ])('accepts JSON values for mixed property unions %#', async (schema, input, expected) => {
    prompt.mockResolvedValueOnce(input);
    await expect(
      promptControlActionAsync(
        'future.union',
        { type: 'object', properties: { value: schema }, required: ['value'] },
        signal
      )
    ).resolves.toEqual({ action: 'future.union', params: { value: expected } });
  });

  it('combines required fields from allOf and keeps optional defaults on the server', async () => {
    const entry = {
      type: 'object',
      properties: { precision: { type: 'integer', default: 4 } },
      allOf: [
        { type: 'object', properties: { lat: { type: 'number' } }, required: ['lat'] },
        { type: 'object', properties: { lng: { type: 'number' } }, required: ['lng'] },
      ],
      args: ['lat', 'lng'],
    };
    prompt.mockResolvedValueOnce('37.5').mockResolvedValueOnce('-122').mockResolvedValueOnce(false);
    await expect(promptControlActionAsync('future.location', entry, signal)).resolves.toEqual({
      action: 'future.location',
      params: { lat: 37.5, lng: -122 },
    });
    expect(prompt.mock.calls[2][0]).toMatchObject({
      message: 'Set optional precision (default: 4)?',
      initial: false,
    });
  });

  it('uses a boolean toggle and supplies required constants without another question', async () => {
    const entry = {
      type: 'object',
      properties: { enabled: { type: 'boolean' }, mode: { const: 'fixed' } },
      required: ['enabled', 'mode'],
    };
    prompt.mockResolvedValueOnce(false);
    await expect(promptControlActionAsync('future.enabled', entry, signal)).resolves.toEqual({
      action: 'future.enabled',
      params: { enabled: false, mode: 'fixed' },
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0]).toMatchObject({
      type: 'toggle',
      active: 'true',
      inactive: 'false',
    });
  });

  it('accepts either a named pose or numeric angle for the existing scalar union', async () => {
    prompt.mockResolvedValueOnce('half').mockResolvedValueOnce('90');
    await expect(
      promptControlActionAsync('hinge.set', catalog['hinge.set'], signal)
    ).resolves.toEqual({ action: 'hinge.set', params: { value: 'half' } });
    await expect(
      promptControlActionAsync('hinge.set', catalog['hinge.set'], signal)
    ).resolves.toEqual({ action: 'hinge.set', params: { value: 90 } });
  });

  it('uses a JSON object for nested alternatives it cannot guide safely', async () => {
    const entry = {
      allOf: [
        { type: 'object', properties: { common: { type: 'string' } }, required: ['common'] },
        {
          anyOf: [
            { properties: { file: { type: 'string' } } },
            { properties: { url: { type: 'string' } } },
          ],
        },
      ],
    };
    prompt.mockResolvedValueOnce('{"common":"test","file":"./file.txt"}');
    await expect(promptControlActionAsync('future.nested', entry, signal)).resolves.toEqual({
      action: 'future.nested',
      params: { common: 'test', file: './file.txt' },
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0][0].message).toContain('JSON object');
  });

  it('does not guess between branches that share the same discriminator value', async () => {
    const entry = {
      oneOf: [
        { properties: { source: { const: 'file' }, path: { type: 'string' } } },
        { properties: { source: { const: 'file' }, uploadId: { type: 'string' } } },
      ],
    };
    prompt.mockResolvedValueOnce('{"source":"file","path":"./test"}');
    await expect(
      promptControlActionAsync('future.ambiguous', entry, signal)
    ).resolves.toMatchObject({ params: { source: 'file', path: './test' } });
    expect(prompt.mock.calls[0][0].message).toContain('JSON object');
  });

  it('keeps an invalid number in the real prompt until the user corrects it', async () => {
    const terminal = useTerminalPrompts();
    const result = promptControlActionAsync('location.set', catalog['location.set'], signal);
    await new Promise(resolve => setImmediate(resolve));
    await terminal.enterAsync('not a number');
    expect(terminal.output()).toContain('Enter a valid number.');
    await terminal.enterAsync('37.5');
    await terminal.enterAsync('-122');
    await expect(result).resolves.toEqual({
      action: 'location.set',
      params: { lat: 37.5, lng: -122 },
    });
  });

  it('requires valid JSON with the right container type before accepting a complex field', async () => {
    const terminal = useTerminalPrompts();
    const entry = {
      type: 'object',
      properties: { events: { type: 'array' } },
      required: ['events'],
    };
    const result = promptControlActionAsync('future.gesture', entry, signal);
    await new Promise(resolve => setImmediate(resolve));
    await terminal.enterAsync('[broken');
    await terminal.enterAsync('{}');
    expect(terminal.output()).toContain('Enter a JSON value matching this parameter.');
    await terminal.enterAsync('[{"type":"begin"}]');
    await expect(result).resolves.toMatchObject({ params: { events: [{ type: 'begin' }] } });
  });

  it('rejects malformed and non-object fallback JSON before accepting corrected parameters', async () => {
    const terminal = useTerminalPrompts();
    const entry = {
      anyOf: [{ properties: { a: { type: 'string' } } }, { properties: { b: { type: 'string' } } }],
    };
    const result = promptControlActionAsync('future.fallback', entry, signal);
    await new Promise(resolve => setImmediate(resolve));
    await terminal.enterAsync('invalid');
    await terminal.enterAsync('[]');
    expect(terminal.output()).toContain('Enter a JSON object.');
    await terminal.enterAsync('{"b":"corrected"}');
    await expect(result).resolves.toMatchObject({ params: { b: 'corrected' } });
  });

  it('requires an output destination before returning a file action', async () => {
    const terminal = useTerminalPrompts();
    const result = promptControlActionAsync(
      'future.screenshot',
      { type: 'object', output: 'base64' },
      signal
    );
    await new Promise(resolve => setImmediate(resolve));
    await terminal.enterAsync('   ');
    expect(terminal.output()).toContain('Enter a local output path.');
    await terminal.enterAsync('./image.png');
    await expect(result).resolves.toEqual({
      action: 'future.screenshot',
      params: {},
      outputPath: './image.png',
    });
  });
});

describe('interactive control loop', () => {
  beforeEach(() => jest.resetAllMocks());

  it('runs one selection at a time and returns to the picker until Exit', async () => {
    const runActionAsync = jest.fn().mockResolvedValue(undefined);
    prompt
      .mockResolvedValueOnce({ kind: 'action', name: 'hardwareKeyboard.set' })
      .mockResolvedValueOnce('on')
      .mockResolvedValueOnce({ kind: 'action', name: 'hardwareKeyboard.set' })
      .mockResolvedValueOnce('off')
      .mockResolvedValueOnce({ kind: 'exit' });
    await runControlMenuAsync({ catalog, signal, runActionAsync });
    expect(runActionAsync.mock.calls).toEqual([
      [{ action: 'hardwareKeyboard.set', params: { value: 'on' } }],
      [{ action: 'hardwareKeyboard.set', params: { value: 'off' } }],
    ]);
  });

  it('returns to the picker after a normal action error without replay', async () => {
    const runActionAsync = jest.fn().mockRejectedValue(new Error('Permission denied'));
    prompt
      .mockResolvedValueOnce({ kind: 'action', name: 'future.action' })
      .mockResolvedValueOnce({ kind: 'exit' });
    await runControlMenuAsync({
      catalog: { 'future.action': { type: 'object' } },
      signal,
      runActionAsync,
    });
    expect(runActionAsync).toHaveBeenCalledTimes(1);
    expect(Log.error).toHaveBeenCalledWith('Permission denied');
  });

  it('does not open another picker while an action is running', async () => {
    let complete!: () => void;
    const runActionAsync = jest.fn(
      () =>
        new Promise<void>(resolve => {
          complete = resolve;
        })
    );
    prompt
      .mockResolvedValueOnce({ kind: 'action', name: 'future.action' })
      .mockResolvedValueOnce({ kind: 'exit' });
    const running = runControlMenuAsync({
      catalog: { 'future.action': { type: 'object' } },
      signal,
      runActionAsync,
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(runActionAsync).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    complete();
    await running;
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('stops after ambiguous transport loss and never opens the next picker', async () => {
    const controller = new AbortController();
    const error = new Error('The action may still have run');
    const runActionAsync = jest.fn(async () => {
      controller.abort(error);
      throw error;
    });
    prompt.mockResolvedValueOnce({ kind: 'action', name: 'future.action' });
    await expect(
      runControlMenuAsync({
        catalog: { 'future.action': { type: 'object' } },
        signal: controller.signal,
        runActionAsync,
      })
    ).rejects.toBe(error);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(runActionAsync).toHaveBeenCalledTimes(1);
  });

  it('unwinds a user cancellation', async () => {
    prompt.mockRejectedValueOnce(new ControlPromptCancelledError());
    await expect(
      runControlMenuAsync({ catalog, signal, runActionAsync: jest.fn() })
    ).rejects.toBeInstanceOf(ControlPromptCancelledError);
  });

  it('keeps the menu open when autocomplete has no matching selection', async () => {
    const runActionAsync = jest.fn();
    prompt.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ kind: 'exit' });
    await expect(runControlMenuAsync({ catalog, signal, runActionAsync })).resolves.toBeUndefined();
    expect(runActionAsync).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('runs a different action after an ordinary rejection', async () => {
    const runActionAsync = jest
      .fn()
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(undefined);
    prompt
      .mockResolvedValueOnce({ kind: 'action', name: 'first' })
      .mockResolvedValueOnce({ kind: 'action', name: 'second' })
      .mockResolvedValueOnce({ kind: 'exit' });
    await runControlMenuAsync({
      catalog: { first: { type: 'object' }, second: { type: 'object' } },
      signal,
      runActionAsync,
    });
    expect(runActionAsync.mock.calls).toEqual([
      [{ action: 'first', params: {} }],
      [{ action: 'second', params: {} }],
    ]);
    expect(Log.error).toHaveBeenCalledWith('Permission denied');
  });

  it('does not send an action when Ctrl-C cancels its parameter prompt', async () => {
    const runActionAsync = jest.fn();
    prompt
      .mockResolvedValueOnce({ kind: 'action', name: 'hardwareKeyboard.set' })
      .mockRejectedValueOnce(new ControlPromptCancelledError());
    await expect(runControlMenuAsync({ catalog, signal, runActionAsync })).rejects.toBeInstanceOf(
      ControlPromptCancelledError
    );
    expect(runActionAsync).not.toHaveBeenCalled();
    expect(Log.error).not.toHaveBeenCalled();
  });

  it('does not open any prompt if initialization already lost the session', async () => {
    const error = new Error('Already disconnected');
    await expect(
      runControlMenuAsync({ catalog, signal: AbortSignal.abort(error), runActionAsync: jest.fn() })
    ).rejects.toBe(error);
    expect(prompt).not.toHaveBeenCalled();
  });
});
