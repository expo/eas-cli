import { validateActionConfig } from '../action';

describe(validateActionConfig, () => {
  it('accepts a valid local action config', () => {
    const config = {
      name: 'Setup',
      inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
      outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
      runs: {
        steps: [{ id: 'read', run: 'set-output version "1.0.0"' }],
      },
    };
    expect(validateActionConfig(config)).toEqual(config);
  });

  it('accepts shorthand input names', () => {
    const config = {
      inputs: ['greeting'],
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(validateActionConfig(config)).toEqual(config);
  });

  it('accepts a minimal config with only runs.steps', () => {
    const config = {
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(validateActionConfig(config)).toEqual(config);
  });

  it('applies default input type "string" when omitted', () => {
    const config = {
      inputs: [{ name: 'greeting' }],
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(validateActionConfig(config)).toEqual({
      inputs: [{ name: 'greeting', type: 'string' }],
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    });
  });

  it('rejects unknown top-level keys', () => {
    const config = {
      unknown_field: true,
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(() => validateActionConfig(config)).toThrow(/unknown_field/);
  });

  it('errors when runs.steps is empty', () => {
    const config = {
      name: 'Broken',
      runs: { steps: [] },
    };
    expect(() => validateActionConfig(config)).toThrow(
      /Invalid action configuration: .*must declare at least one step under "runs.steps"/
    );
  });

  it('includes actionReference in validation errors when provided', () => {
    const config = {
      name: 'Broken',
      runs: { steps: [] },
    };
    expect(() => validateActionConfig(config, { actionReference: './.eas/actions/setup' })).toThrow(
      /Invalid action "\.\/\.eas\/actions\/setup": .*must declare at least one step/
    );
  });
});
