import fs from 'fs/promises';
import assert from 'node:assert';
import path from 'node:path';

import { parseCompositeFunctions } from './StepsConfigParser-composite-functions-test-utils';
import { getErrorAsync } from './utils/error';
import { BuildWorkflow } from '../BuildWorkflow';
import { BuildWorkflowError } from '../errors';

const SAY_HI = './.eas/functions/say-hi';

const createdDirectories: string[] = [];

async function executeWorkflowAsync(workflow: BuildWorkflow): Promise<void> {
  const globalCtx = workflow.buildSteps[0].ctx.global;
  for (const directory of [
    globalCtx.defaultWorkingDirectory,
    globalCtx.stepsInternalBuildDirectory,
  ]) {
    await fs.mkdir(directory, { recursive: true });
    createdDirectories.push(directory);
  }
  await workflow.executeAsync();
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.map(directory => fs.rm(directory, { recursive: true, force: true }))
  );
  createdDirectories.length = 0;
});

describe('StepsConfigParser local single-step functions', () => {
  describe('expansion', () => {
    it('expands a command function into one step keeping the caller id', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { name: 'Say hi', command: 'echo hi' } },
        steps: [
          {
            uses: SAY_HI,
            id: 'greet',
            name: 'Greet the world',
            env: { GREETING: 'Hi' },
            if: '${{ always() }}',
          },
        ],
      });

      expect(workflow.buildSteps).toHaveLength(1);
      const [step] = workflow.buildSteps;
      expect(step.id).toBe('greet');
      expect(step.displayName).toBe('Greet the world');
      expect(step.command).toBe('echo hi');
      expect(step.fn).toBeUndefined();
      expect(step.ifCondition).toBe('${{ always() }}');
      expect(step.stepEnvOverrides).toEqual({ GREETING: 'Hi' });
    });

    it('falls back to the function name and then to the function path for the display name', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: { name: 'Say hi', command: 'echo hi' },
          './.eas/functions/anonymous': { command: 'echo anonymous' },
        },
        steps: [
          { uses: SAY_HI, id: 'greet' },
          { uses: './.eas/functions/anonymous', id: 'anonymous' },
        ],
      });

      expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
        'Say hi',
        './.eas/functions/anonymous',
      ]);
    });

    it('generates a step id when the caller has none', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { command: 'echo hi' } },
        steps: [{ uses: SAY_HI }],
      });

      expect(workflow.buildSteps[0].id).toMatch(/^step-\d{3,}$/);
    });

    it('expands repeated calls to the same function into separate steps', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { command: 'echo hi' } },
        steps: [
          { uses: SAY_HI, id: 'first' },
          { uses: SAY_HI, id: 'second' },
        ],
      });

      expect(workflow.buildSteps.map(step => step.id)).toEqual(['first', 'second']);
    });

    it('forwards the function-level shell to the step', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { command: 'echo hi', shell: 'sh' } },
        steps: [{ uses: SAY_HI, id: 'greet' }],
      });

      expect(workflow.buildSteps[0].shell).toBe('sh');
    });

    it('expands a path function into a step calling the module', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: { path: path.resolve(__dirname, './fixtures/my-custom-ts-function') },
        },
        steps: [{ uses: SAY_HI, id: 'greet' }],
      });

      const [step] = workflow.buildSteps;
      expect(step.command).toBeUndefined();
      expect(step.fn).toBeDefined();
    });

    it('registers the expanded function in workflow.buildFunctions keyed by its path', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { command: 'echo hi' } },
        steps: [{ uses: SAY_HI, id: 'greet' }],
      });

      expect(workflow.buildFunctions[SAY_HI]).toBeDefined();
      expect(workflow.buildFunctions[SAY_HI].command).toBe('echo hi');
    });

    it('forwards working_directory from the caller to the step', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { command: 'echo hi' } },
        steps: [{ uses: SAY_HI, id: 'greet', working_directory: 'packages/app' }],
      });

      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('packages/app');
    });

    it('throws a clear error for a function missing from the catalog', async () => {
      await expect(
        parseCompositeFunctions({ steps: [{ uses: SAY_HI, id: 'greet' }] })
      ).rejects.toThrow(/Local function ".\/.eas\/functions\/say-hi" does not exist/);
    });
  });

  describe('inputs', () => {
    it('passes caller values to the function inputs', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: {
            inputs: ['name'],
            outputs: ['greeting'],
            command: 'set-output greeting "Hi, ${ inputs.name }!"',
          },
        },
        steps: [{ uses: SAY_HI, id: 'greet', with: { name: 'World' } }],
      });
      await executeWorkflowAsync(workflow);

      expect(workflow.buildSteps[0].getOutputValueByName('greeting')).toBe('Hi, World!');
    });

    it('applies the declared default when the caller omits a value', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: {
            inputs: [{ name: 'name', type: 'string', default_value: 'World', required: false }],
            outputs: ['greeting'],
            command: 'set-output greeting "Hi, ${ inputs.name }!"',
          },
        },
        steps: [{ uses: SAY_HI, id: 'greet' }],
      });
      await executeWorkflowAsync(workflow);

      expect(workflow.buildSteps[0].getOutputValueByName('greeting')).toBe('Hi, World!');
    });

    it('treats shorthand inputs as required, unlike composite function inputs', async () => {
      const error = await getErrorAsync<BuildWorkflowError>(() =>
        parseCompositeFunctions({
          catalog: { [SAY_HI]: { inputs: ['name'], command: 'echo hi' } },
          steps: [{ uses: SAY_HI, id: 'greet' }],
        })
      );

      expect(error).toBeInstanceOf(BuildWorkflowError);
      assert(error instanceof BuildWorkflowError);
      expect(error.errors[0].message).toBe(
        'Input parameter "name" for step "./.eas/functions/say-hi" is required but it was not set.'
      );
    });

    it('accepts an input declared as not required', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: {
            inputs: [{ name: 'name', type: 'string', required: false }],
            command: 'echo hi',
          },
        },
        steps: [{ uses: SAY_HI, id: 'greet' }],
      });

      expect(workflow.buildSteps).toHaveLength(1);
    });

    it('rejects a value outside the declared allowed values', async () => {
      const error = await getErrorAsync<BuildWorkflowError>(() =>
        parseCompositeFunctions({
          catalog: {
            [SAY_HI]: {
              inputs: [
                {
                  name: 'platform',
                  type: 'string',
                  default_value: 'ios',
                  allowed_values: ['ios', 'android'],
                },
              ],
              command: 'echo hi',
            },
          },
          steps: [{ uses: SAY_HI, id: 'greet', with: { platform: 'web' } }],
        })
      );

      expect(error).toBeInstanceOf(BuildWorkflowError);
      assert(error instanceof BuildWorkflowError);
      expect(error.errors[0].message).toBe(
        'Input parameter "platform" for step "./.eas/functions/say-hi" is set to "web" which is not one of the allowed values: "ios", "android".'
      );
    });
  });

  describe('outputs', () => {
    it('exposes declared outputs to later steps', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: { outputs: ['version'], command: 'set-output version "1.0.0"' },
        },
        steps: [
          { uses: SAY_HI, id: 'read' },
          {
            id: 'copy',
            run: 'set-output copied "${{ steps.read.outputs.version }}"',
            outputs: [{ name: 'copied', required: true }],
          },
        ],
      });
      await executeWorkflowAsync(workflow);

      expect(workflow.buildSteps[0].getOutputValueByName('version')).toBe('1.0.0');
      expect(workflow.buildSteps[1].getOutputValueByName('copied')).toBe('1.0.0');
    });

    it('treats shorthand outputs as required', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { outputs: ['version'], command: 'echo hi' } },
        steps: [{ uses: SAY_HI, id: 'read' }],
      });

      await expect(executeWorkflowAsync(workflow)).rejects.toThrow(
        /Some required outputs have not been set: "version"/
      );
    });

    it('accepts an output declared as not required', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SAY_HI]: { outputs: [{ name: 'version', required: false }], command: 'echo hi' },
        },
        steps: [{ uses: SAY_HI, id: 'read' }],
      });

      await expect(executeWorkflowAsync(workflow)).resolves.toBeUndefined();
    });
  });

  describe('supported platforms', () => {
    it('rejects a function that does not support the runtime platform', async () => {
      const error = await getErrorAsync<BuildWorkflowError>(() =>
        parseCompositeFunctions({
          catalog: { [SAY_HI]: { command: 'echo hi', supported_platforms: ['darwin'] } },
          steps: [{ uses: SAY_HI, id: 'greet' }],
        })
      );

      expect(error).toBeInstanceOf(BuildWorkflowError);
      assert(error instanceof BuildWorkflowError);
      expect(error.errors[0].message).toBe(
        'Step "./.eas/functions/say-hi" is not allowed on platform "linux". Allowed platforms for this step are: "darwin".'
      );
    });

    it('accepts a function that supports the runtime platform', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: { [SAY_HI]: { command: 'echo hi', supported_platforms: ['linux'] } },
        steps: [{ uses: SAY_HI, id: 'greet' }],
      });

      expect(workflow.buildSteps).toHaveLength(1);
    });
  });

  describe('inside a composite function', () => {
    it('expands a single-step function called from a composite function', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            inputs: [{ name: 'name', type: 'string', default_value: 'World' }],
            outputs: { greeting: { value: '${{ steps.inner.outputs.greeting }}' } },
            runs: {
              steps: [{ id: 'inner', uses: SAY_HI, with: { name: '${{ inputs.name }}' } }],
            },
          },
          [SAY_HI]: {
            inputs: ['name'],
            outputs: ['greeting'],
            command: 'set-output greeting "Hi, ${ inputs.name }!"',
          },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'outer', with: { name: 'Expo' } }],
      });
      await executeWorkflowAsync(workflow);

      const [innerStep, outputsStep] = workflow.buildSteps;
      expect(innerStep.id).toBe('outer__inner');
      expect(innerStep.getOutputValueByName('greeting')).toBe('Hi, Expo!');
      expect(outputsStep.id).toBe('outer');
      expect(outputsStep.getOutputValueByName('greeting')).toBe('Hi, Expo!');
    });

    it('exposes the outputs of a nested single-step function to its siblings', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            runs: {
              steps: [
                { id: 'inner', uses: SAY_HI },
                {
                  id: 'copy',
                  run: 'set-output copied "${{ steps.inner.outputs.version }}"',
                  outputs: [{ name: 'copied', required: true }],
                },
              ],
            },
          },
          [SAY_HI]: { outputs: ['version'], command: 'set-output version "1.0.0"' },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'outer' }],
      });
      await executeWorkflowAsync(workflow);

      expect(workflow.buildSteps.map(step => step.id)).toEqual(['outer__inner', 'outer__copy']);
      expect(workflow.buildSteps[1].getOutputValueByName('copied')).toBe('1.0.0');
    });

    it('forwards working_directory from a nested call to the step', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            runs: {
              steps: [{ id: 'inner', uses: SAY_HI, working_directory: 'packages/app' }],
            },
          },
          [SAY_HI]: { command: 'echo hi' },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'outer' }],
      });

      expect(workflow.buildSteps[0].id).toBe('outer__inner');
      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('packages/app');
    });
  });
});
