import { z } from 'zod';

import { LocalFunctionConfigZ, isLegacyFunctionConfig } from '../localFunction';

const GENERIC_ERROR_MESSAGE =
  'A local function must declare exactly one of "runs.steps" (a composite function), "command" (a shell script) or "path" (a JavaScript function module), and its fields must match that shape.';

describe('LocalFunctionConfigZ', () => {
  it('parses a composite function', () => {
    const config = {
      name: 'Setup',
      inputs: ['greeting'],
      outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
      runs: { steps: [{ id: 'read', run: 'set-output version "1.0.0"' }] },
    };
    const parsed = LocalFunctionConfigZ.parse(config);
    expect(parsed).toEqual(config);
    expect(isLegacyFunctionConfig(parsed)).toBe(false);
  });

  it('parses a command function', () => {
    const config = { name: 'Say hi', inputs: ['name'], command: 'echo hi' };
    const parsed = LocalFunctionConfigZ.parse(config);
    expect(parsed).toEqual(config);
    expect(isLegacyFunctionConfig(parsed)).toBe(true);
  });

  it('parses a path function', () => {
    const parsed = LocalFunctionConfigZ.parse({ path: './my-function' });
    expect(parsed).toEqual({ path: './my-function' });
    expect(isLegacyFunctionConfig(parsed)).toBe(true);
  });

  it('parses a command function using the camelCase spellings of custom build configs', () => {
    const parsed = LocalFunctionConfigZ.parse({
      command: 'echo hi',
      supportedRuntimePlatforms: ['darwin'],
    });
    expect(parsed).toEqual({ command: 'echo hi', supported_platforms: ['darwin'] });
    expect(isLegacyFunctionConfig(parsed)).toBe(true);
  });

  it('surfaces the min-steps issue of the composite branch with its field path', () => {
    const result = LocalFunctionConfigZ.safeParse({ runs: { steps: [] } });
    expect(result.success).toBe(false);
    expect(z.prettifyError(result.error!)).toMatch(
      /must declare at least one step under "runs.steps"\.\n {2}→ at runs.steps/
    );
  });

  it.each<[string, unknown, string]>([
    [
      'an unknown top-level key on a composite function',
      { shel: 'bash', runs: { steps: [{ run: 'echo hi' }] } },
      '✖ Unrecognized key: "shel"',
    ],
    [
      'an unknown top-level key on a command function',
      { command: 'echo hi', runz: {} },
      '✖ Unrecognized key: "runz"',
    ],
    [
      'an unknown top-level key on a path function',
      { path: './fn', run: 'echo' },
      '✖ Unrecognized key: "run"',
    ],
    [
      'an unknown supported platform',
      { command: 'echo hi', supported_platforms: ['windows'] },
      '✖ Invalid option: expected one of "darwin"|"linux" (at supported_platforms.0)',
    ],
    [
      'the composite output shape on a single-step function',
      { command: 'echo hi', outputs: { version: { value: '1.0.0' } } },
      '✖ Invalid input: expected array, received object (at outputs)',
    ],
    [
      'a non-string command',
      { command: 42 },
      '✖ Invalid input: expected string, received number (at command)',
    ],
  ])('rejects %s with the field-level branch error', (_description, config, expectedError) => {
    const result = LocalFunctionConfigZ.safeParse(config);
    expect(result.success).toBe(false);
    expect(z.prettifyError(result.error!)).toBe(expectedError);
  });

  it.each<[string, unknown]>([
    [
      'a config mixing runs.steps with command',
      { command: 'echo hi', runs: { steps: [{ run: 'echo hello' }] } },
    ],
    [
      'a config mixing runs.steps with path',
      { path: './my-function', runs: { steps: [{ run: 'echo hello' }] } },
    ],
    ['a config declaring both command and path', { command: 'echo hi', path: './fn' }],
    ['a config declaring none of runs.steps, command and path', { name: 'Nothing' }],
    ['an empty mapping', {}],
    ['a string in place of a mapping', 'command: echo hi'],
    ['an array in place of a mapping', [{ command: 'echo hi' }]],
    ['null in place of a mapping', null],
  ])('rejects %s with the generic union message', (_description, config) => {
    const result = LocalFunctionConfigZ.safeParse(config);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map(issue => issue.message)).toEqual([GENERIC_ERROR_MESSAGE]);
  });
});
