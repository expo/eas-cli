import {
  SETUP,
  failingFunction,
  parseCompositeFunctions,
  passThroughFunction,
  setVersionFunction,
} from './StepsConfigParser-composite-functions-test-utils';
import { getErrorAsync } from './utils/error';
import { BuildStepStatus } from '../BuildStep';

describe('StepsConfigParser local composite functions', () => {
  describe('outputs', () => {
    it('creates a synthetic outputs step that exposes declared composite function outputs', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            name: 'Setup',
            inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [
                { id: 'read', run: 'set-output version "1.0.0"' },
                { run: 'echo "${{ inputs.greeting }}"' },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { greeting: 'hi' } }],
      });

      expect(workflow.buildSteps).toHaveLength(3);

      const [readStep, echoStep, outputsStep] = workflow.buildSteps;
      expect(readStep.id).toBe('setup__read');
      expect(readStep.displayName).toBe('read');
      expect(echoStep.id).toBe('setup__composite_function_step_1');
      expect(echoStep.command).toBe('echo "${{ inputs.greeting }}"');

      expect(outputsStep.id).toBe('setup');
      expect(outputsStep.displayName).toBe('Setup');
      expect(outputsStep.command).toBeUndefined();
      expect(outputsStep.fn).toBeDefined();
      expect(Object.keys(outputsStep.outputById)).toEqual(['version']);
    });

    it('uses a generated synthetic id for the outputs step when the caller has no id', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            name: 'Setup',
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [
                { id: 'read', run: 'set-output version "1.0.0"' },
                { id: 'echo', run: 'echo "${{ steps.read.outputs.version }}"' },
              ],
            },
          },
        },
        steps: [{ uses: SETUP }],
      });

      const [readStep, echoStep, outputsStep] = workflow.buildSteps;
      const syntheticStepId = readStep.id.split('__')[0];

      expect(syntheticStepId).toMatch(/^step-\d{3,}$/);
      expect(readStep.id).toBe(`${syntheticStepId}__read`);
      expect(echoStep.command).toBe('echo "${{ steps.read.outputs.version }}"');
      expect(outputsStep.id).toBe(syntheticStepId);
    });

    it('uses the caller step name for the synthetic outputs step display name', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            name: 'Setup',
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [{ id: 'read', run: 'set-output version "1.0.0"' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', name: 'Prepare release' }],
      });

      const outputsStep = workflow.buildSteps[1];
      expect(outputsStep.id).toBe('setup');
      expect(outputsStep.displayName).toBe('Prepare release');
    });

    it('sets composite composite function outputs via fn without shell interpolation', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [{ id: 'read', uses: 'test/set-version' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [setVersionFunction()],
      });
      await workflow.executeAsync();

      const outputsStep = workflow.buildSteps[1];
      expect(outputsStep.getOutputValueByName('version')).toBe('$(echo injected)');
    });

    it('leaves legacy ${ steps.* } references in composite function outputs uninterpolated', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: { version: { value: '${ steps.read.outputs.version }' } },
            runs: {
              steps: [{ id: 'read', uses: 'test/set-version' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [setVersionFunction()],
      });
      await workflow.executeAsync();

      const outputsStep = workflow.buildSteps[1];
      expect(outputsStep.getOutputValueByName('version')).toBe('${ steps.read.outputs.version }');
    });

    it('runs the outputs step after a failed inner step when caller uses always(), setting composite function outputs to empty strings', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [{ id: 'read', uses: 'test/fail' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', if: '${{ always() }}' }],
        externalFunctions: [failingFunction()],
      });

      const innerStep = workflow.buildSteps[0];
      const outputsStep = workflow.buildSteps[1];
      expect(outputsStep.ifCondition).toBe('${{ always() }}');

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      expect(innerStep.status).toBe(BuildStepStatus.FAIL);
      expect(outputsStep.status).toBe(BuildStepStatus.SUCCESS);
      expect(outputsStep.getOutputValueByName('version')).toBe('');
    });

    it('exposes outputs from both the outer and a nested inner action', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            outputs: { outer_version: { value: '${{ steps.mid.outputs.inner_version }}' } },
            runs: { steps: [{ uses: './.eas/functions/inner', id: 'mid' }] },
          },
          './.eas/functions/inner': {
            outputs: { inner_version: { value: '${{ steps.read.outputs.version }}' } },
            runs: { steps: [{ id: 'read', uses: 'test/set-version' }] },
          },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'top' }],
        externalFunctions: [setVersionFunction()],
      });
      await workflow.executeAsync();

      const innerOutputsStep = workflow.buildSteps.find(s => s.id === 'top__mid');
      const outerOutputsStep = workflow.buildSteps.find(s => s.id === 'top');
      expect(innerOutputsStep?.getOutputValueByName('inner_version')).toBe('$(echo injected)');
      expect(outerOutputsStep?.getOutputValueByName('outer_version')).toBe('$(echo injected)');
    });

    it('resolves call-site env in the caller scope for the outputs step', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: { out: { value: '${{ env.FOO }}' } },
            runs: {
              steps: [{ id: 'inner', uses: 'test/passthrough', with: { value: '${{ env.FOO }}' } }],
            },
          },
        },
        steps: [
          { id: 'prev', uses: 'test/set-version' },
          { uses: SETUP, id: 'setup', env: { FOO: '${{ steps.prev.outputs.version }}' } },
        ],
        externalFunctions: [setVersionFunction(), passThroughFunction()],
      });
      await workflow.executeAsync();

      const innerStep = workflow.buildSteps.find(s => s.id === 'setup__inner');
      const outputsStep = workflow.buildSteps.find(s => s.id === 'setup');
      expect(innerStep?.getOutputValueByName('out')).toBe('$(echo injected)');
      expect(outputsStep?.getOutputValueByName('out')).toBe('$(echo injected)');
    });

    it('resolves inputs referenced in output templates', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [
              { name: 'greeting', type: 'string' },
              { name: 'farewell', type: 'string', default_value: 'bye' },
            ],
            outputs: {
              greeting: { value: '${{ inputs.greeting }}' },
              farewell: { value: '${{ inputs.farewell }}' },
            },
            runs: {
              steps: [{ id: 'noop', uses: 'test/passthrough', with: { value: 'x' } }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { greeting: 'hi' } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();

      const outputsStep = workflow.buildSteps.find(s => s.id === 'setup');
      expect(outputsStep?.getOutputValueByName('greeting')).toBe('hi');
      expect(outputsStep?.getOutputValueByName('farewell')).toBe('bye');
    });

    it('skips the outputs step when the call-site if skips the whole action', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [{ id: 'read', uses: 'test/set-version' }],
            },
          },
        },
        steps: [
          { uses: SETUP, id: 'setup', if: '${{ false }}' },
          {
            id: 'after',
            uses: 'test/passthrough',
            with: { value: '${{ steps.setup.outputs.version }}' },
          },
        ],
        externalFunctions: [setVersionFunction(), passThroughFunction()],
      });
      await workflow.executeAsync();

      const innerStep = workflow.buildSteps.find(s => s.id === 'setup__read');
      const outputsStep = workflow.buildSteps.find(s => s.id === 'setup');
      const afterStep = workflow.buildSteps.find(s => s.id === 'after');
      expect(innerStep?.status).toBe(BuildStepStatus.SKIPPED);
      expect(outputsStep?.status).toBe(BuildStepStatus.SKIPPED);
      expect(afterStep?.getOutputValueByName('out')).toBe('');
    });

    it('hides flattened inner step ids from the workflow realm while exposing declared outputs', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [{ id: 'read', uses: 'test/set-version' }],
            },
          },
        },
        steps: [
          { uses: SETUP, id: 'setup' },
          {
            id: 'public',
            uses: 'test/passthrough',
            with: { value: '${{ steps.setup.outputs.version }}' },
          },
          {
            id: 'leak',
            uses: 'test/passthrough',
            with: { value: '${{ steps.setup__read.outputs.version }}' },
          },
        ],
        externalFunctions: [setVersionFunction(), passThroughFunction()],
      });

      await workflow.executeAsync();

      const outputFor = (id: string): string | undefined =>
        workflow.buildSteps.find(s => s.id === id)?.getOutputValueByName('out');
      expect(outputFor('public')).toBe('$(echo injected)');
      expect(workflow.buildSteps.some(s => s.id === 'setup__read')).toBe(true);
      expect(outputFor('leak')).toBe('');
    });
  });
  describe('skipped inner steps', () => {
    it('resolves ${{ }} outputs referencing a skipped inner step to empty strings and leaves legacy refs literal', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            outputs: {
              version: { value: '${ steps.read.outputs.version }' },
              version_expr: { value: '${{ steps.read.outputs.version }}' },
            },
            runs: {
              steps: [{ id: 'read', uses: 'test/set-version', if: '${{ 1 == 2 }}' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [setVersionFunction()],
      });

      await workflow.executeAsync();

      const innerStep = workflow.buildSteps[0];
      const outputsStep = workflow.buildSteps[1];
      expect(innerStep.status).toBe(BuildStepStatus.SKIPPED);
      expect(outputsStep.status).toBe(BuildStepStatus.SUCCESS);
      expect(outputsStep.getOutputValueByName('version')).toBe('${ steps.read.outputs.version }');
      expect(outputsStep.getOutputValueByName('version_expr')).toBe('');
    });

    it('resolves an out-of-scope action output reference to an empty string', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/notify': {
            outputs: { sha: { value: '${{ steps.checkout.outputs.sha }}' } },
            runs: {
              steps: [
                { id: 'noop', uses: 'test/passthrough', with: { value: 'x' }, if: '${{ false }}' },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/functions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'notify')?.getOutputValueByName('sha')).toBe(
        ''
      );
    });
  });
});
