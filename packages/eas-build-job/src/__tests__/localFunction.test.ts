import { z } from 'zod';

import { LocalFunctionConfigZ, isLegacyFunctionConfig } from '../localFunction';

function parseErrorMessages(schema: z.ZodType, config: unknown): string[] {
  const result = schema.safeParse(config);
  expect(result.success).toBe(false);
  return result.error!.issues.map(issue => issue.message);
}

const UNION_ERROR_MESSAGE =
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

  it.each<[string, unknown]>([
    ['unknown top-level keys on a command function', { command: 'echo hi', runz: {} }],
    ['unknown top-level keys on a path function', { path: './fn', run: 'echo' }],
    ['unknown supported platforms', { command: 'echo hi', supported_platforms: ['windows'] }],
    [
      'the composite output shape on a single-step function',
      { command: 'echo hi', outputs: { version: { value: '1.0.0' } } },
    ],
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
    expect(parseErrorMessages(LocalFunctionConfigZ, config)).toEqual([UNION_ERROR_MESSAGE]);
  });

  it('collapses branch errors into the union message in formatted output', () => {
    const result = LocalFunctionConfigZ.safeParse({ command: 42 });
    expect(result.success).toBe(false);
    expect(z.prettifyError(result.error!)).toBe(`✖ ${UNION_ERROR_MESSAGE}`);
  });

  it('surfaces the min-steps issue of the composite branch with its field path', () => {
    const result = LocalFunctionConfigZ.safeParse({ runs: { steps: [] } });
    expect(result.success).toBe(false);
    expect(z.prettifyError(result.error!)).toMatch(
      /must declare at least one step under "runs.steps"\.\n {2}→ at runs.steps/
    );
  });
});
