import { ZodError } from 'zod';

import { ActionConfigZ } from '../action';

describe('ActionConfigZ', () => {
  it('accepts a valid local action config', () => {
    const config = {
      name: 'Setup',
      inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
      outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
      runs: {
        steps: [{ id: 'read', run: 'set-output version "1.0.0"' }],
      },
    };
    expect(ActionConfigZ.parse(config)).toEqual(config);
  });

  it('accepts shorthand input names', () => {
    const config = {
      inputs: ['greeting'],
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(ActionConfigZ.parse(config)).toEqual(config);
  });

  it('accepts a minimal config with only runs.steps', () => {
    const config = {
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(ActionConfigZ.parse(config)).toEqual(config);
  });

  it('applies default input type "string" when omitted', () => {
    const config = {
      inputs: [{ name: 'greeting' }],
      runs: {
        steps: [{ run: 'echo hello' }],
      },
    };
    expect(ActionConfigZ.parse(config)).toEqual({
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
    expect(() => ActionConfigZ.parse(config)).toThrow(ZodError);
    expect(() => ActionConfigZ.parse(config)).toThrow(/unknown_field/);
  });

  it('errors when runs.steps is empty', () => {
    const config = {
      name: 'Broken',
      runs: { steps: [] },
    };
    expect(() => ActionConfigZ.parse(config)).toThrow(ZodError);
    try {
      ActionConfigZ.parse(config);
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).issues[0]?.message).toMatch(
        /must declare at least one step under "runs.steps"/
      );
    }
  });
});
