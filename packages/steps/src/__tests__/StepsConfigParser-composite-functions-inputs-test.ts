import {
  SETUP,
  actionReadingInput,
  echoInputAction,
  parseCompositeFunctions,
  passThroughFunction,
} from './StepsConfigParser-composite-functions-test-utils';
import { getErrorAsync } from './utils/error';
import { BuildConfigError, BuildStepRuntimeError } from '../errors';

describe('StepsConfigParser local composite functions', () => {
  describe('input handling', () => {
    it('uses the composite function input default when the caller omits the value', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: echoInputAction('greeting', {
            name: 'greeting',
            type: 'string',
            default_value: 'hello',
          }),
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });
      expect(workflow.buildSteps[0].command).toBe('echo "${{ inputs.greeting }}"');
    });

    it.each([
      [
        'boolean',
        { name: 'enabled', type: 'boolean' },
        { enabled: true },
        'echo "${{ inputs.enabled }}"',
      ],
      ['number', { name: 'count', type: 'number' }, { count: 3 }, 'echo "${{ inputs.count }}"'],
    ])(
      'accepts an explicit %s value, leaving the command raw',
      async (_typeLabel, inputDef, withInputs, expectedCommand) => {
        const workflow = await parseCompositeFunctions({
          catalog: { [SETUP]: echoInputAction(inputDef.name, inputDef) },
          steps: [{ uses: SETUP, id: 'setup', with: withInputs }],
        });
        expect(workflow.buildSteps[0].command).toBe(expectedCommand);
      }
    );

    it('ignores unknown caller inputs, matching function-step behavior', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SETUP]: actionReadingInput({ name: 'greeting', type: 'string' }) },
        steps: [{ uses: SETUP, id: 'setup', with: { greetng: 'hi' } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'setup__inner')?.getOutputValueByName('out')
      ).toBe('');
    });

    it('does not error for a missing required input that is never referenced', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'token', type: 'string', required: true }],
            runs: { steps: [{ id: 'inner', uses: 'test/passthrough', with: { value: 'static' } }] },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'setup__inner')?.getOutputValueByName('out')
      ).toBe('static');
    });

    it.each([
      [
        'a required input is missing but referenced',
        actionReadingInput({ name: 'token', type: 'string', required: true }),
        [{ uses: SETUP, id: 'setup' }],
        /Input parameter "token" for step ".+" is required but it was not set/,
      ],
      [
        'a provided input has the wrong type',
        actionReadingInput({ name: 'count', type: 'number' }),
        [{ uses: SETUP, id: 'setup', with: { count: 'two' } }],
        /Input parameter "count" for step ".+" must be of type "number"/,
      ],
      [
        'a string does not parse as JSON for a json input',
        actionReadingInput({ name: 'config', type: 'json' }),
        [{ uses: SETUP, id: 'setup', with: { config: 'literal' } }],
        /Input parameter "config" for step ".+" must be of type "json"/,
      ],
    ])('errors at runtime when %s', async (_, actionConfig, steps, message) => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SETUP]: actionConfig },
        steps,
        externalFunctions: [passThroughFunction()],
      });
      const error = await getErrorAsync<BuildStepRuntimeError>(() => workflow.executeAsync());
      expect(error).toBeInstanceOf(BuildStepRuntimeError);
      expect(error.message).toMatch(message);
    });

    it('coerces a provided string value to the declared number type', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'count', type: 'number' }],
            runs: {
              steps: [
                {
                  id: 'inner',
                  uses: 'test/passthrough',
                  // Without number coercion, `'2' + 1` would render as `21`.
                  with: { value: 'next-${{ inputs.count + 1 }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { count: '2' } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'setup__inner')?.getOutputValueByName('out')
      ).toBe('next-3');
    });

    it('falls back to the default resolved in the composite function scope when the caller passes null', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: actionReadingInput({ name: 'greeting', type: 'string', default_value: 'hello' }),
        },
        steps: [{ uses: SETUP, id: 'setup', with: { greeting: null } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'setup__inner')?.getOutputValueByName('out')
      ).toBe('hello');
    });

    it('accepts a provided literal value that is one of allowed_values', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: actionReadingInput({
            name: 'greeting',
            type: 'string',
            allowed_values: ['hi', 'hello'],
          }),
        },
        steps: [{ uses: SETUP, id: 'setup', with: { greeting: 'hello' } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'setup__inner')?.getOutputValueByName('out')
      ).toBe('hello');
    });

    it('rejects at parse time a provided literal value outside allowed_values', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseCompositeFunctions({
          catalog: {
            [SETUP]: actionReadingInput({
              name: 'greeting',
              type: 'string',
              allowed_values: ['hi', 'hello'],
            }),
          },
          steps: [{ uses: SETUP, id: 'setup', with: { greeting: 'bye' } }],
          externalFunctions: [passThroughFunction()],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toMatch(/not one of the allowed values/);
    });

    it('resolves an undeclared input reference to an empty value', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
            runs: {
              steps: [
                {
                  id: 'inner',
                  uses: 'test/passthrough',
                  with: { value: '${{ inputs.gretting }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'setup__inner')?.getOutputValueByName('out')
      ).toBe('');
    });
  });
});
