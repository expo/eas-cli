import { ZodError } from 'zod';

import { LegacyCommandFunctionConfigZ, LegacyPathFunctionConfigZ } from '../legacyFunction';

describe('LegacyCommandFunctionConfigZ', () => {
  it('accepts a command function with inputs, outputs, shell and supported platforms', () => {
    const config = {
      name: 'Say hi',
      inputs: [
        'name',
        { name: 'greeting', type: 'string', default_value: 'Hi', allowed_values: ['Hi', 'Hello'] },
        { name: 'loud', type: 'boolean', required: false },
        { name: 'suffix' },
      ],
      outputs: ['greeted', { name: 'skipped', required: false }],
      command: 'echo "${ inputs.greeting }, ${ inputs.name }!"',
      shell: 'sh',
      supported_platforms: ['darwin', 'linux'],
    };
    expect(LegacyCommandFunctionConfigZ.parse(config)).toEqual({
      ...config,
      inputs: [
        'name',
        { name: 'greeting', type: 'string', default_value: 'Hi', allowed_values: ['Hi', 'Hello'] },
        { name: 'loud', type: 'boolean', required: false },
        { name: 'suffix', type: 'string' },
      ],
    });
  });

  it('accepts a minimal config with only command', () => {
    const config = { command: 'echo hi' };
    expect(LegacyCommandFunctionConfigZ.parse(config)).toEqual(config);
  });

  it('rejects unknown top-level keys', () => {
    const config = { command: 'echo hi', runz: {} };
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(ZodError);
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(/runz/);
  });

  it('rejects description, which the legacy shape does not support', () => {
    const config = { command: 'echo hi', description: 'x' };
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(ZodError);
  });

  it('rejects unknown supported platforms', () => {
    const config = { command: 'echo hi', supported_platforms: ['windows'] };
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(ZodError);
  });

  it('rejects the composite output shape', () => {
    const config = { command: 'echo hi', outputs: { version: { value: '1.0.0' } } };
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(ZodError);
  });

  it('rejects a config declaring runs.steps', () => {
    const config = { command: 'echo hi', runs: { steps: [{ run: 'echo hello' }] } };
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(ZodError);
  });

  it('rejects a config also declaring path', () => {
    const config = { command: 'echo hi', path: './fn' };
    expect(() => LegacyCommandFunctionConfigZ.parse(config)).toThrow(ZodError);
  });
});

describe('LegacyPathFunctionConfigZ', () => {
  it('accepts a minimal config with only path', () => {
    const config = { path: './my-function' };
    expect(LegacyPathFunctionConfigZ.parse(config)).toEqual(config);
  });

  it('accepts shell alongside path', () => {
    const config = { path: './my-function', shell: 'sh' };
    expect(LegacyPathFunctionConfigZ.parse(config)).toEqual(config);
  });

  it('rejects unknown top-level keys', () => {
    const config = { path: './fn', run: 'echo' };
    expect(() => LegacyPathFunctionConfigZ.parse(config)).toThrow(ZodError);
    expect(() => LegacyPathFunctionConfigZ.parse(config)).toThrow(/run/);
  });

  it('rejects a config declaring runs.steps', () => {
    const config = { path: './fn', runs: { steps: [{ run: 'echo hello' }] } };
    expect(() => LegacyPathFunctionConfigZ.parse(config)).toThrow(ZodError);
  });

  it('rejects a config also declaring command', () => {
    const config = { path: './fn', command: 'echo hi' };
    expect(() => LegacyPathFunctionConfigZ.parse(config)).toThrow(ZodError);
  });
});
