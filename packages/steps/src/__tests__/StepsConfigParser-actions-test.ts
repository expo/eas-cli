import { ActionCatalog, ActionConfigZ, Step } from '@expo/eas-build-job';
import assert from 'node:assert';

import { createGlobalContextMock } from './utils/context';
import { getErrorAsync } from './utils/error';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepStatus } from '../BuildStep';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildStepOutput } from '../BuildStepOutput';
import { BuildWorkflow } from '../BuildWorkflow';
import { StepsConfigParser } from '../StepsConfigParser';
import { BuildConfigError, BuildWorkflowError } from '../errors';

const SETUP = './.eas/actions/setup';

function makeCatalog(entries: Record<string, unknown>): ActionCatalog {
  const catalog: ActionCatalog = {};
  for (const [actionPath, raw] of Object.entries(entries)) {
    catalog[actionPath] = ActionConfigZ.parse(raw);
  }
  return catalog;
}

async function parseActions(options: {
  catalog?: Record<string, unknown>;
  steps: Step[];
  externalFunctions?: BuildFunction[];
  externalFunctionGroups?: BuildFunctionGroup[];
}): Promise<BuildWorkflow> {
  const ctx = createGlobalContextMock();
  const parser = new StepsConfigParser(ctx, {
    steps: options.steps,
    actionCatalog: makeCatalog(options.catalog ?? {}),
    externalFunctions: options.externalFunctions,
    externalFunctionGroups: options.externalFunctionGroups,
  });
  return parser.parseAsync();
}

function echoFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'echo',
    fn: () => {},
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'value',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
  });
}

function setVersionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'set-version',
    fn: (_ctx, { outputs }) => {
      outputs.version.set('$(echo injected)');
    },
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'version',
        required: true,
      }),
    ],
  });
}

function failingFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'fail',
    fn: () => {
      throw new Error('inner failed');
    },
  });
}

function passThroughFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'passthrough',
    fn: (_ctx, { inputs, outputs }) => {
      outputs.out.set(String(inputs.value.value ?? ''));
    },
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'value',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'out', required: true })],
  });
}

function captureEnvFunction(
  sink: (env: Record<string, string | undefined>) => void
): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'capture-env',
    fn: (_ctx, { env }) => {
      sink(env);
    },
  });
}

function echoInputAction(inputName: string, input: Record<string, unknown>) {
  return {
    inputs: [input],
    runs: { steps: [{ run: `echo "\${{ inputs.${inputName} }}"` }] },
  };
}

describe('StepsConfigParser local actions', () => {
  describe('expansion', () => {
    it('expands a single-level composite action, binding inputs and exposing outputs', async () => {
      const workflow = await parseActions({
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
      expect(echoStep.id).toBe('setup__action_step_1');
      expect(echoStep.command).toBe('echo "${{ inputs.greeting }}"');

      expect(outputsStep.id).toBe('setup');
      expect(outputsStep.displayName).toBe('Setup');
      expect(outputsStep.command).toBeUndefined();
      expect(outputsStep.fn).toBeDefined();
      expect(Object.keys(outputsStep.outputById)).toEqual(['version']);
    });

    it('generates a synthetic id when the caller step has no id', async () => {
      const workflow = await parseActions({
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
      const workflow = await parseActions({
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

    it('keeps templated inner step names raw at parse time', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'env', type: 'string', default_value: 'staging' }],
            runs: {
              steps: [{ name: 'Deploy ${{ inputs.env }}', run: 'echo deploy' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { env: 'production' } }],
      });

      expect(workflow.buildSteps[0].displayName).toBe('Deploy ${{ inputs.env }}');
    });

    it('derives the fallback display name of an unnamed inner shell step from the raw run', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'target', type: 'string', default_value: 'build' }],
            runs: {
              steps: [{ run: '${{ inputs.target }} do-thing' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { target: 'release' } }],
      });

      const [innerStep] = workflow.buildSteps;
      expect(innerStep.command).toBe('${{ inputs.target }} do-thing');
      expect(innerStep.displayName).toBe('${{ inputs.target }} do-thing');
    });

    it('expands nested composites with accumulated prefixes', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/outer': {
            runs: { steps: [{ uses: './.eas/actions/inner', id: 'mid' }] },
          },
          './.eas/actions/inner': {
            runs: { steps: [{ id: 'leaf', run: 'echo leaf' }] },
          },
        },
        steps: [{ uses: './.eas/actions/outer', id: 'top' }],
      });
      expect(workflow.buildSteps.map(s => s.id)).toEqual(['top__mid__leaf']);
    });

    it('avoids collisions between generated inner step ids and declared inner step ids', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                { run: 'echo first (no id)' },
                { id: 'action_step_1', run: 'echo second (declared)' },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });

      expect(workflow.buildSteps.map(s => s.id)).toEqual([
        'setup__action_step_2',
        'setup__action_step_1',
      ]);
    });
  });

  describe('outputs', () => {
    it('sets composite action outputs via fn without shell interpolation', async () => {
      const workflow = await parseActions({
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

    it('resolves legacy ${ steps.* } step output references in action outputs', async () => {
      const workflow = await parseActions({
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
      expect(outputsStep.getOutputValueByName('version')).toBe('$(echo injected)');
    });

    it('runs the outputs step after a failed inner step when caller uses always(), setting action outputs to empty strings', async () => {
      const workflow = await parseActions({
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
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/outer': {
            outputs: { outer_version: { value: '${{ steps.mid.outputs.inner_version }}' } },
            runs: { steps: [{ uses: './.eas/actions/inner', id: 'mid' }] },
          },
          './.eas/actions/inner': {
            outputs: { inner_version: { value: '${{ steps.read.outputs.version }}' } },
            runs: { steps: [{ id: 'read', uses: 'test/set-version' }] },
          },
        },
        steps: [{ uses: './.eas/actions/outer', id: 'top' }],
        externalFunctions: [setVersionFunction()],
      });
      await workflow.executeAsync();

      const innerOutputsStep = workflow.buildSteps.find(s => s.id === 'top__mid');
      const outerOutputsStep = workflow.buildSteps.find(s => s.id === 'top');
      expect(innerOutputsStep?.getOutputValueByName('inner_version')).toBe('$(echo injected)');
      expect(outerOutputsStep?.getOutputValueByName('outer_version')).toBe('$(echo injected)');
    });
  });

  describe('step reference scoping', () => {
    it("resolves inner steps.* references against the action's own steps, isolating two callers", async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/pair': {
            inputs: [{ name: 'tag', type: 'string', required: true }],
            runs: {
              steps: [
                { id: 'a', uses: 'test/passthrough', with: { value: '${{ inputs.tag }}' } },
                {
                  id: 'b',
                  uses: 'test/passthrough',
                  with: { value: '${{ steps.a.outputs.out }}' },
                },
              ],
            },
          },
        },
        steps: [
          { uses: './.eas/actions/pair', id: 'first', with: { tag: 'first-tag' } },
          { uses: './.eas/actions/pair', id: 'second', with: { tag: 'second-tag' } },
        ],
        externalFunctions: [passThroughFunction()],
      });

      const ids = workflow.buildSteps.map(s => s.id);
      expect(ids).toEqual(['first__a', 'first__b', 'second__a', 'second__b']);

      await workflow.executeAsync();

      expect(workflow.buildSteps.find(s => s.id === 'first__b')?.getOutputValueByName('out')).toBe(
        'first-tag'
      );
      expect(workflow.buildSteps.find(s => s.id === 'second__b')?.getOutputValueByName('out')).toBe(
        'second-tag'
      );
    });

    it('leaves step references raw, untouched inside longer identifiers', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/pair': {
            runs: {
              steps: [
                { id: 'a', run: 'set-output v "x"' },
                { id: 'b', run: 'echo "mysteps.a.outputs.v ${{ steps.a.outputs.v }}"' },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/pair', id: 'caller' }],
      });

      const bStep = workflow.buildSteps.find(s => s.id === 'caller__b');
      expect(bStep?.command).toBe('echo "mysteps.a.outputs.v ${{ steps.a.outputs.v }}"');
    });

    it('resolves references to steps whose ids share a prefix', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/pair': {
            runs: {
              steps: [
                { id: 'a', uses: 'test/passthrough', with: { value: 'short' } },
                { id: 'ab', uses: 'test/passthrough', with: { value: 'long' } },
                {
                  id: 'c',
                  uses: 'test/passthrough',
                  with: { value: '${{ steps.a.outputs.out }}-${{ steps.ab.outputs.out }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/pair', id: 'caller' }],
        externalFunctions: [passThroughFunction()],
      });

      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'caller__c')?.getOutputValueByName('out')).toBe(
        'short-long'
      );
    });

    it('resolves caller step references passed through action inputs against the caller scope', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/notify': {
            inputs: [{ name: 'msg', type: 'string', required: true }],
            runs: {
              steps: [
                { id: 'build', uses: 'test/passthrough', with: { value: 'inner build' } },
                { id: 'report', uses: 'test/passthrough', with: { value: '${{ inputs.msg }}' } },
              ],
            },
          },
        },
        steps: [
          { id: 'build', uses: 'test/set-version' },
          {
            uses: './.eas/actions/notify',
            id: 'notify',
            with: { msg: '${{ steps.build.outputs.version }}' },
          },
        ],
        externalFunctions: [passThroughFunction(), setVersionFunction()],
      });

      await workflow.executeAsync();

      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('$(echo injected)');
    });

    it("resolves inner step references in action input defaults against the action's own steps", async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/notify': {
            inputs: [
              { name: 'msg', type: 'string', default_value: '${{ steps.build.outputs.version }}' },
            ],
            runs: {
              steps: [
                { id: 'build', uses: 'test/set-version' },
                { id: 'report', uses: 'test/passthrough', with: { value: '${{ inputs.msg }}' } },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction(), setVersionFunction()],
      });

      await workflow.executeAsync();

      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('$(echo injected)');
    });

    it('resolves an out-of-scope step reference to an empty value', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/notify': {
            runs: {
              steps: [
                {
                  id: 'report',
                  uses: 'test/passthrough',
                  with: { value: '${{ steps.checkout.outputs.sha }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('');
    });

    it('resolves an out-of-scope legacy step reference to an empty value', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/notify': {
            runs: {
              steps: [
                {
                  id: 'report',
                  uses: 'test/passthrough',
                  with: { value: '${ steps.checkout.sha }' },
                },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('');
    });

    it('resolves an out-of-scope action output reference to an empty string', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/notify': {
            outputs: { sha: { value: '${{ steps.checkout.outputs.sha }}' } },
            runs: {
              steps: [
                { id: 'noop', uses: 'test/passthrough', with: { value: 'x' }, if: '${{ false }}' },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'notify')?.getOutputValueByName('sha')).toBe(
        ''
      );
    });
  });

  describe('caller context propagation', () => {
    it('binds action inputs into inner function step inputs', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/wrap': {
            inputs: [{ name: 'msg', type: 'string', required: true }],
            runs: {
              steps: [
                { id: 'inner', uses: 'test/passthrough', with: { value: '${{ inputs.msg }}' } },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/actions/wrap', id: 'wrap', with: { msg: 'bound-value' } }],
        externalFunctions: [passThroughFunction()],
      });
      const innerStep = workflow.buildSteps[0];
      expect(innerStep.inputs?.[0].id).toBe('value');
      expect(innerStep.inputs?.[0].rawValue).toBe('${{ inputs.msg }}');

      await workflow.executeAsync();
      expect(innerStep.getOutputValueByName('out')).toBe('bound-value');
    });

    it('propagates caller env to expanded inner steps and keeps only their own if condition', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'inner', run: 'echo hi', if: '${{ success() }}' }] },
          },
        },
        steps: [
          {
            uses: SETUP,
            id: 'setup',
            env: { CALLER: 'value' },
            if: '${{ always() }}',
          },
        ],
      });
      const inner = workflow.buildSteps[0];
      expect(inner.stepEnvOverrides).toMatchObject({ CALLER: 'value' });
      expect(inner.ifCondition).toBe('${{ success() }}');
      expect(inner.actionScope).toBeDefined();
    });

    it('skips an inner always() step when the caller if condition is false', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'inner', uses: 'eas/echo', if: '${{ always() }}' }] },
          },
        },
        steps: [
          { id: 'fail', uses: 'test/fail' },
          { uses: SETUP, id: 'setup', if: '${{ success() }}' },
        ],
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const innerStep = workflow.buildSteps.find(s => s.id === 'setup__inner');
      expect(innerStep?.status).toBe(BuildStepStatus.SKIPPED);
    });

    it('runs inner steps of a failure()-gated action after an earlier workflow failure', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                { id: 'first', uses: 'eas/echo', with: { value: 'cleanup' } },
                { id: 'second', uses: 'eas/echo', with: { value: 'notify' } },
              ],
            },
          },
        },
        steps: [
          { id: 'fail', uses: 'test/fail' },
          { uses: SETUP, id: 'cleanup', if: '${{ failure() }}' },
        ],
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const firstStep = workflow.buildSteps.find(s => s.id === 'cleanup__first');
      const secondStep = workflow.buildSteps.find(s => s.id === 'cleanup__second');
      expect(firstStep?.status).toBe(BuildStepStatus.SUCCESS);
      expect(secondStep?.status).toBe(BuildStepStatus.SUCCESS);
    });

    it('skips inner steps of a failure()-gated action when no previous step failed', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'inner', uses: 'eas/echo', with: { value: 'cleanup' } }] },
          },
        },
        steps: [
          { id: 'ok', uses: 'eas/echo', with: { value: 'ok' } },
          { uses: SETUP, id: 'cleanup', if: '${{ failure() }}' },
        ],
        externalFunctions: [echoFunction()],
      });

      await workflow.executeAsync();

      const innerStep = workflow.buildSteps.find(s => s.id === 'cleanup__inner');
      expect(innerStep?.status).toBe(BuildStepStatus.SKIPPED);
    });

    it('stops after an inner failure inside a failure()-gated action, but runs inner failure() cleanup', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                { id: 'breaks', uses: 'test/fail' },
                { id: 'after', uses: 'eas/echo', with: { value: 'should not run' } },
                {
                  id: 'inner_cleanup',
                  uses: 'eas/echo',
                  with: { value: 'cleanup' },
                  if: '${{ failure() }}',
                },
              ],
            },
          },
        },
        steps: [
          { id: 'fail', uses: 'test/fail' },
          { uses: SETUP, id: 'cleanup', if: '${{ failure() }}' },
        ],
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const breaksStep = workflow.buildSteps.find(s => s.id === 'cleanup__breaks');
      const afterStep = workflow.buildSteps.find(s => s.id === 'cleanup__after');
      const innerCleanupStep = workflow.buildSteps.find(s => s.id === 'cleanup__inner_cleanup');
      expect(breaksStep?.status).toBe(BuildStepStatus.FAIL);
      expect(afterStep?.status).toBe(BuildStepStatus.SKIPPED);
      expect(innerCleanupStep?.status).toBe(BuildStepStatus.SUCCESS);
    });

    it('propagates a nested action failure to subsequent steps of the outer action', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/outer': {
            runs: {
              steps: [
                { uses: './.eas/actions/inner', id: 'nested' },
                { id: 'after', uses: 'eas/echo', with: { value: 'should not run' } },
              ],
            },
          },
          './.eas/actions/inner': {
            runs: { steps: [{ id: 'breaks', uses: 'test/fail' }] },
          },
        },
        steps: [{ uses: './.eas/actions/outer', id: 'top', if: '${{ always() }}' }],
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const afterStep = workflow.buildSteps.find(s => s.id === 'top__after');
      expect(afterStep?.status).toBe(BuildStepStatus.SKIPPED);
    });

    it('does not block inner steps of an always()-gated action after earlier workflow failure', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'cleanup', uses: 'eas/echo', with: { value: 'cleanup' } }] },
          },
        },
        steps: [
          { id: 'fail', uses: 'test/fail' },
          { uses: SETUP, id: 'setup', if: '${{ always() }}' },
        ],
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const cleanupStep = workflow.buildSteps.find(s => s.id === 'setup__cleanup');
      expect(cleanupStep?.status).toBe(BuildStepStatus.SUCCESS);
    });

    it('propagates caller working_directory to inner steps that do not declare one', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'inner', run: 'echo hi' }] },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', working_directory: 'packages/app' }],
      });
      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('packages/app');
    });

    it('lets an inner step working_directory override the caller working_directory', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'dir', type: 'string', default_value: 'inner/dir' }],
            runs: {
              steps: [
                {
                  id: 'inner',
                  uses: 'test/passthrough',
                  with: { value: 'ok' },
                  working_directory: '${{ inputs.dir }}',
                },
              ],
            },
          },
        },
        steps: [
          {
            uses: SETUP,
            id: 'setup',
            working_directory: 'caller/dir',
            with: { dir: 'overridden/dir' },
          },
        ],
        externalFunctions: [passThroughFunction()],
      });
      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('${{ inputs.dir }}');
      await workflow.executeAsync();
      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('overridden/dir');
    });

    it('interpolates action inputs inside inner step if expressions', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'flag', type: 'string', required: true }],
            runs: {
              steps: [{ id: 'inner', run: 'echo hi', if: '${{ inputs.flag == "true" }}' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { flag: 'true' } }],
      });
      expect(workflow.buildSteps[0].ifCondition).toBe('${{ inputs.flag == "true" }}');
    });
  });

  describe('input handling at parse time', () => {
    it('uses the action input default when the caller omits the value', async () => {
      const workflow = await parseActions({
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
        const workflow = await parseActions({
          catalog: { [SETUP]: echoInputAction(inputDef.name, inputDef) },
          steps: [{ uses: SETUP, id: 'setup', with: withInputs }],
        });
        expect(workflow.buildSteps[0].command).toBe(expectedCommand);
      }
    );

    it.each([5, true, '"literal"', '[1, 2]'])(
      'accepts scalar %p for a json input',
      async config => {
        await expect(
          parseActions({
            catalog: {
              [SETUP]: echoInputAction('config', { name: 'config', type: 'json' }),
            },
            steps: [{ uses: SETUP, id: 'setup', with: { config } }],
          })
        ).resolves.toBeDefined();
      }
    );

    it('rejects a string that does not parse as JSON for a json input', async () => {
      const error = await getErrorAsync<BuildWorkflowError>(() =>
        parseActions({
          catalog: {
            [SETUP]: echoInputAction('config', { name: 'config', type: 'json' }),
          },
          steps: [{ uses: SETUP, id: 'setup', with: { config: 'literal' } }],
        })
      );
      expect(error.message).toMatch(
        /input "config" must be of type "json" but got "literal", which is not a valid JSON string/
      );
    });

    it('accepts structurally equal json input when value matches allowed_values', async () => {
      await expect(
        parseActions({
          catalog: {
            [SETUP]: {
              inputs: [
                {
                  name: 'config',
                  type: 'json',
                  allowed_values: [{ mode: 'dev' }, { mode: 'prod' }],
                },
              ],
              runs: { steps: [{ run: 'echo done' }] },
            },
          },
          steps: [{ uses: SETUP, id: 'setup', with: { config: { mode: 'dev' } } }],
        })
      ).resolves.toBeDefined();
    });

    it.each([
      [
        'a required input is missing',
        echoInputAction('token', { name: 'token', type: 'string', required: true }),
        [{ uses: SETUP, id: 'setup' }],
        /requires input "token"/,
      ],
      [
        'called with an unknown input',
        echoInputAction('greeting', { name: 'greeting', type: 'string' }),
        [{ uses: SETUP, id: 'setup', with: { greetng: 'hi' } }],
        /unknown input "greetng"/,
      ],
      [
        'a provided input has the wrong type',
        echoInputAction('count', { name: 'count', type: 'number' }),
        [{ uses: SETUP, id: 'setup', with: { count: 'two' } }],
        /must be of type "number"/,
      ],
      [
        'explicit null is provided instead of falling back to default_value',
        echoInputAction('greeting', {
          name: 'greeting',
          type: 'string',
          default_value: 'hello',
        }),
        [{ uses: SETUP, id: 'setup', with: { greeting: null } }],
        /must be of type "string"/,
      ],
      [
        'a provided input is not in allowed_values',
        echoInputAction('greeting', {
          name: 'greeting',
          type: 'string',
          allowed_values: ['hi', 'hello'],
        }),
        [{ uses: SETUP, id: 'setup', with: { greeting: 'bye' } }],
        /must be one of/,
      ],
      [
        'json input is not structurally equal to any allowed_values entry',
        {
          inputs: [
            {
              name: 'config',
              type: 'json',
              allowed_values: [{ mode: 'dev' }, { mode: 'prod' }],
            },
          ],
          runs: { steps: [{ run: 'echo done' }] },
        },
        [{ uses: SETUP, id: 'setup', with: { config: { mode: 'staging' } } }],
        /must be one of/,
      ],
    ])('errors when %s', async (_, actionConfig, steps, message) => {
      await expect(parseActions({ catalog: { [SETUP]: actionConfig }, steps })).rejects.toThrow(
        message
      );
    });

    it('resolves an undeclared input reference to an empty value', async () => {
      const workflow = await parseActions({
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

  describe('resolution errors', () => {
    it('throws a clear error for an unknown action', async () => {
      await expect(
        parseActions({
          steps: [{ uses: './.eas/actions/missing', id: 'x' }],
        })
      ).rejects.toThrow(/Local action ".\/.eas\/actions\/missing"/);
    });

    it.each([
      [
        'direct self-reference',
        {
          './.eas/actions/loop': {
            runs: { steps: [{ uses: './.eas/actions/loop', id: 'again' }] },
          },
        },
        [{ uses: './.eas/actions/loop', id: 'loop' }],
      ],
      [
        'indirect reference',
        {
          './.eas/actions/a': { runs: { steps: [{ uses: './.eas/actions/b', id: 'b' }] } },
          './.eas/actions/b': { runs: { steps: [{ uses: './.eas/actions/a', id: 'a' }] } },
        },
        [{ uses: './.eas/actions/a', id: 'a' }],
      ],
    ])('detects %s cycles', async (_, catalog, steps) => {
      await expect(parseActions({ catalog, steps })).rejects.toThrow(/cycle/i);
    });

    it('errors when an action declares duplicated inner step ids', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseActions({
          catalog: {
            [SETUP]: {
              runs: {
                steps: [
                  { run: 'echo one', id: 'dup' },
                  { run: 'echo two', id: 'dup' },
                ],
              },
            },
          },
          steps: [{ uses: SETUP, id: 'setup' }],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toBe(
        `Action "${SETUP}" declares duplicated step IDs: "dup". Step IDs within an action must be unique.`
      );
    });

    it('errors when an inner step references a non-existent function', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseActions({
          catalog: {
            './.eas/actions/wrap': {
              runs: { steps: [{ uses: 'eas/typo', id: 'echo' }] },
            },
          },
          steps: [{ uses: './.eas/actions/wrap', id: 'wrap' }],
          externalFunctions: [echoFunction()],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toBe(
        'Action "./.eas/actions/wrap" calls non-existent function "eas/typo".'
      );
    });

    it('errors when an inner step uses a function group', async () => {
      await expect(
        parseActions({
          catalog: {
            './.eas/actions/wrap': {
              runs: { steps: [{ uses: 'eas/build', id: 'build' }] },
            },
          },
          steps: [{ uses: './.eas/actions/wrap', id: 'wrap' }],
          externalFunctionGroups: [
            new BuildFunctionGroup({
              namespace: 'eas',
              id: 'build',
              createBuildStepsFromFunctionGroupCall: () => [],
            }),
          ],
        })
      ).rejects.toThrow(/Function group "eas\/build" cannot be used inside an action/);
    });

    it('allows action chains at the maximum nesting depth without a cycle', async () => {
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < 10; i++) {
        entries[`./.eas/actions/a${i}`] =
          i < 9
            ? { runs: { steps: [{ uses: `./.eas/actions/a${i + 1}`, id: `s${i}` }] } }
            : { runs: { steps: [{ run: 'echo leaf' }] } };
      }
      const workflow = await parseActions({
        catalog: entries,
        steps: [{ uses: './.eas/actions/a0', id: 'top' }],
      });
      expect(workflow).toBeDefined();
    });

    it('throws when action nesting exceeds the maximum depth without a cycle', async () => {
      const entries: Record<string, unknown> = {};
      for (let i = 0; i <= 10; i++) {
        entries[`./.eas/actions/a${i}`] =
          i < 10
            ? { runs: { steps: [{ uses: `./.eas/actions/a${i + 1}`, id: `s${i}` }] } }
            : { runs: { steps: [{ run: 'echo leaf' }] } };
      }
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseActions({
          catalog: entries,
          steps: [{ uses: './.eas/actions/a0', id: 'top' }],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toMatch(/Maximum action nesting depth \(10\) exceeded/);
    });
  });

  describe('scoped runtime evaluation', () => {
    it("evaluates the caller if condition against the caller's env overrides", async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'inner', uses: 'eas/echo' }] },
          },
        },
        steps: [
          {
            uses: SETUP,
            id: 'setup',
            env: { DEPLOY: 'true' },
            if: "${{ env.DEPLOY == 'true' }}",
          },
        ],
        externalFunctions: [echoFunction()],
      });
      await workflow.executeAsync();
      expect(workflow.buildSteps[0].status).toBe(BuildStepStatus.SUCCESS);
    });

    it("evaluates the caller if condition against the caller env, not an inner step's env overrides", async () => {
      const ctx = createGlobalContextMock();
      ctx.updateEnv({ DEPLOY: 'true' });
      const parser = new StepsConfigParser(ctx, {
        steps: [{ uses: SETUP, id: 'setup', if: "${{ env.DEPLOY == 'true' }}" }],
        actionCatalog: makeCatalog({
          [SETUP]: {
            runs: { steps: [{ id: 'inner', uses: 'eas/echo', env: { DEPLOY: 'false' } }] },
          },
        }),
        externalFunctions: [echoFunction()],
      });
      const workflow = await parser.parseAsync();
      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'setup__inner')?.status).toBe(
        BuildStepStatus.SUCCESS
      );
    });

    it('resolves an expression-valued input used inside an inner if condition at runtime', async () => {
      const okFunction = new BuildFunction({
        namespace: 'test',
        id: 'ok',
        fn: (_ctx, { outputs }) => {
          outputs.ok.set('true');
        },
        outputProviders: [BuildStepOutput.createProvider({ id: 'ok', required: true })],
      });
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'flag', type: 'string' }],
            runs: {
              steps: [{ id: 'gated', uses: 'eas/echo', if: '${{ inputs.flag == "true" }}' }],
            },
          },
        },
        steps: [
          { id: 'prev', uses: 'test/ok' },
          { uses: SETUP, id: 'setup', with: { flag: '${{ steps.prev.outputs.ok }}' } },
        ],
        externalFunctions: [okFunction, echoFunction()],
      });
      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'setup__gated')?.status).toBe(
        BuildStepStatus.SUCCESS
      );
    });

    it('uses scoped success() in input interpolation, matching if condition semantics', async () => {
      let captured: unknown;
      const captureFunction = new BuildFunction({
        namespace: 'test',
        id: 'capture',
        fn: (_ctx, { inputs }) => {
          captured = inputs.value.value;
        },
        inputProviders: [
          BuildStepInput.createProvider({
            id: 'value',
            allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            required: false,
          }),
        ],
      });
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                {
                  id: 'check',
                  uses: 'test/capture',
                  with: { value: 'ok-${{ success() }}' },
                  if: '${{ always() }}',
                },
              ],
            },
          },
        },
        steps: [
          { id: 'fail', uses: 'test/fail' },
          { uses: SETUP, id: 'setup', if: '${{ always() }}' },
        ],
        externalFunctions: [failingFunction(), captureFunction],
      });
      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');
      expect(workflow.buildSteps.find(s => s.id === 'setup__check')?.status).toBe(
        BuildStepStatus.SUCCESS
      );
      expect(captured).toBe('ok-true');
    });
  });

  describe('bare if conditions', () => {
    it('substitutes action inputs in bare inner if expressions', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'flag', type: 'string', required: true }],
            runs: {
              steps: [{ id: 'inner', uses: 'eas/echo', if: 'inputs.flag == "true"' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { flag: 'true' } }],
        externalFunctions: [echoFunction()],
      });
      expect(workflow.buildSteps[0].ifCondition).toBe('inputs.flag == "true"');

      await workflow.executeAsync();
      expect(workflow.buildSteps[0].status).toBe(BuildStepStatus.SUCCESS);
    });

    it('resolves inner step references in bare if expressions at runtime', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                { id: 'read', uses: 'test/set-version' },
                {
                  id: 'gated',
                  uses: 'eas/echo',
                  if: "steps.read.outputs.version == '$(echo injected)'",
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [setVersionFunction(), echoFunction()],
      });
      expect(workflow.buildSteps[1].ifCondition).toBe(
        "steps.read.outputs.version == '$(echo injected)'"
      );

      await workflow.executeAsync();
      expect(workflow.buildSteps[1].status).toBe(BuildStepStatus.SUCCESS);
    });

    it('skips an inner step when a bare if references an out-of-scope step', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                {
                  id: 'inner',
                  uses: 'test/passthrough',
                  with: { value: 'ok' },
                  if: "steps.checkout.outputs.sha == 'x'",
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'setup__inner')?.status).toBe(
        BuildStepStatus.SKIPPED
      );
    });
  });

  describe('expression tokenization', () => {
    it('substitutes inputs adjacent to arithmetic operators in inner run commands', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [
              { name: 'total', type: 'number', default_value: 10 },
              { name: 'count', type: 'number', default_value: 2 },
            ],
            runs: {
              steps: [{ run: 'echo ${{ inputs.total/inputs.count }}' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });
      expect(workflow.buildSteps[0].command).toBe('echo ${{ inputs.total/inputs.count }}');
    });

    it('does not truncate inner expressions at }} inside string literals', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'platform', type: 'string', default_value: 'android' }],
            runs: {
              steps: [{ run: 'echo hi', if: '${{ contains(inputs.platform, "a}}b") }}' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });
      expect(workflow.buildSteps[0].ifCondition).toBe('${{ contains(inputs.platform, "a}}b") }}');
    });
  });

  describe('skipped inner steps', () => {
    it('resolves action outputs referencing a skipped inner step to empty strings', async () => {
      const workflow = await parseActions({
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
      expect(outputsStep.getOutputValueByName('version')).toBe('');
      expect(outputsStep.getOutputValueByName('version_expr')).toBe('');
    });
  });

  describe('step id collisions', () => {
    it('reports a clear error when a user step id collides with an expanded action step id', async () => {
      const error = await getErrorAsync<BuildWorkflowError>(() =>
        parseActions({
          catalog: { [SETUP]: { runs: { steps: [{ id: 'read', run: 'true' }] } } },
          steps: [
            { id: 'setup__read', run: 'true' },
            { uses: SETUP, id: 'setup' },
          ],
        })
      );
      expect(error).toBeInstanceOf(BuildWorkflowError);
      assert(error instanceof BuildWorkflowError);
      expect(error.errors[0].message).toMatch(
        /collide with steps created by expanding a local action/
      );
    });
  });

  describe('lifted restrictions and runtime resolution', () => {
    it('resolves an input whose value mixes text with an expression, used inside an inner expression', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'target', type: 'string' }],
            runs: {
              steps: [
                {
                  id: 'gate',
                  uses: 'test/passthrough',
                  with: { value: 'ran' },
                  if: '${{ inputs.target == "prod-1" }}',
                },
              ],
            },
          },
        },
        steps: [
          { id: 'prev', uses: 'test/passthrough', with: { value: '1' } },
          { uses: SETUP, id: 'setup', with: { target: 'prod-${{ steps.prev.outputs.out }}' } },
        ],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();

      const gate = workflow.buildSteps.find(s => s.id === 'setup__gate');
      expect(gate?.status).toBe(BuildStepStatus.SUCCESS);
      expect(gate?.getOutputValueByName('out')).toBe('ran');
    });

    it('supports property access on a json input at runtime', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'config', type: 'json' }],
            runs: {
              steps: [
                {
                  id: 'show',
                  uses: 'test/passthrough',
                  with: { value: 'retries=${{ inputs.config.retries }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { config: { retries: 3 } } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();

      expect(
        workflow.buildSteps.find(s => s.id === 'setup__show')?.getOutputValueByName('out')
      ).toBe('retries=3');
    });

    it('resolves a hyphenated input referenced with bracket syntax', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'app-name', type: 'string' }],
            runs: {
              steps: [
                {
                  id: 'show',
                  uses: 'test/passthrough',
                  with: { value: `\${{ inputs['app-name'] }}` },
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { 'app-name': 'my-app' } }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();

      expect(
        workflow.buildSteps.find(s => s.id === 'setup__show')?.getOutputValueByName('out')
      ).toBe('my-app');
    });

    it('does not resolve a hyphenated input referenced with dot syntax', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'app-name', type: 'string' }],
            runs: {
              steps: [
                {
                  id: 'inner',
                  uses: 'test/passthrough',
                  with: { value: '${{ inputs.app-name }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { 'app-name': 'my-app' } }],
        externalFunctions: [passThroughFunction()],
      });
      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toMatch(/Invalid identifier "name"/);
    });

    it('validates an expression-valued constrained input against allowed_values at runtime', async () => {
      const makeWorkflow = (provided: string): Promise<BuildWorkflow> =>
        parseActions({
          catalog: {
            [SETUP]: {
              inputs: [{ name: 'env', type: 'string', allowed_values: ['dev', 'prod'] }],
              runs: {
                steps: [
                  { id: 'show', uses: 'test/passthrough', with: { value: '${{ inputs.env }}' } },
                ],
              },
            },
          },
          steps: [
            { id: 'pick', uses: 'test/passthrough', with: { value: provided } },
            { uses: SETUP, id: 'setup', with: { env: '${{ steps.pick.outputs.out }}' } },
          ],
          externalFunctions: [passThroughFunction()],
        });

      const okWorkflow = await makeWorkflow('prod');
      await okWorkflow.executeAsync();
      expect(
        okWorkflow.buildSteps.find(s => s.id === 'setup__show')?.getOutputValueByName('out')
      ).toBe('prod');

      const badWorkflow = await makeWorkflow('staging');
      const error = await getErrorAsync<Error>(() => badWorkflow.executeAsync());
      expect(error.message).toMatch(/input "env" must be one of: "dev", "prod"/);
    });

    it('resolves an expression-valued env override into the process env', async () => {
      let capturedEnv: Record<string, string | undefined> = {};
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'token', type: 'string' }],
            runs: {
              steps: [
                { id: 'read', uses: 'test/capture-env', env: { MY_TOKEN: '${{ inputs.token }}' } },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { token: 'secret' } }],
        externalFunctions: [captureEnvFunction(env => (capturedEnv = env))],
      });
      await workflow.executeAsync();

      expect(capturedEnv.MY_TOKEN).toBe('secret');
    });

    it('throws a runtime error when an input default references itself indirectly', async () => {
      const workflow = await parseActions({
        catalog: {
          [SETUP]: {
            inputs: [
              { name: 'a', type: 'string', default_value: '${{ inputs.b }}' },
              { name: 'b', type: 'string', default_value: '${{ inputs.a }}' },
            ],
            runs: {
              steps: [{ id: 'show', uses: 'test/passthrough', with: { value: '${{ inputs.a }}' } }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
        externalFunctions: [passThroughFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toMatch(/input "a" references itself/);
    });

    it('resolves nested action if and with against the outer action inputs at runtime', async () => {
      const workflow = await parseActions({
        catalog: {
          './.eas/actions/wrap': {
            inputs: [
              { name: 'flag', type: 'string' },
              { name: 'msg', type: 'string' },
            ],
            runs: {
              steps: [
                {
                  uses: './.eas/actions/inner',
                  id: 'inner',
                  if: '${{ inputs.flag == "go" }}',
                  with: { text: '${{ inputs.msg }}' },
                },
              ],
            },
          },
          './.eas/actions/inner': {
            inputs: [{ name: 'text', type: 'string' }],
            runs: {
              steps: [
                { id: 'show', uses: 'test/passthrough', with: { value: '${{ inputs.text }}' } },
              ],
            },
          },
        },
        steps: [
          { id: 'prev', uses: 'test/passthrough', with: { value: 'hello' } },
          {
            uses: './.eas/actions/wrap',
            id: 'wrap',
            with: { flag: 'go', msg: '${{ steps.prev.outputs.out }}' },
          },
        ],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();

      const show = workflow.buildSteps.find(s => s.id === 'wrap__inner__show');
      expect(show?.status).toBe(BuildStepStatus.SUCCESS);
      expect(show?.getOutputValueByName('out')).toBe('hello');
    });
  });
});
