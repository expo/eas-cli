import {
  SETUP,
  captureEnvFunction,
  echoFunction,
  failingFunction,
  makeCatalog,
  parseCompositeFunctions,
  passThroughFunction,
  setVersionFunction,
} from './StepsConfigParser-composite-functions-test-utils';
import { createGlobalContextMock } from './utils/context';
import { getErrorAsync } from './utils/error';
import { BuildFunction } from '../BuildFunction';
import { StepsConfigParser } from '../StepsConfigParser';
import { BuildStepStatus } from '../BuildStep';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildStepOutput } from '../BuildStepOutput';
import { BuildWorkflow } from '../BuildWorkflow';
import { BuildConfigError, BuildStepRuntimeError } from '../errors';

describe('StepsConfigParser local composite functions', () => {
  describe('step reference scoping', () => {
    it("resolves inner steps.* references against the composite function's own steps, isolating two callers", async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/pair': {
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
          { uses: './.eas/functions/pair', id: 'first', with: { tag: 'first-tag' } },
          { uses: './.eas/functions/pair', id: 'second', with: { tag: 'second-tag' } },
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

    it('rejects a legacy workflow-realm reference to a flattened inner step id', async () => {
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
            id: 'leak-legacy',
            uses: 'test/passthrough',
            with: { value: '${ steps.setup__read.version }' },
          },
        ],
        externalFunctions: [setVersionFunction(), passThroughFunction()],
      });

      const error = await getErrorAsync<BuildStepRuntimeError>(() => workflow.executeAsync());
      expect(error).toBeInstanceOf(BuildStepRuntimeError);
      expect(error.message).toMatch(/Step "setup__read" does not exist/);
    });

    it('leaves step references raw, untouched inside longer identifiers', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/pair': {
            runs: {
              steps: [
                { id: 'a', run: 'set-output v "x"' },
                { id: 'b', run: 'echo "mysteps.a.outputs.v ${{ steps.a.outputs.v }}"' },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/functions/pair', id: 'caller' }],
      });

      const bStep = workflow.buildSteps.find(s => s.id === 'caller__b');
      expect(bStep?.command).toBe('echo "mysteps.a.outputs.v ${{ steps.a.outputs.v }}"');
    });

    it('resolves references to steps whose ids share a prefix', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/pair': {
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
        steps: [{ uses: './.eas/functions/pair', id: 'caller' }],
        externalFunctions: [passThroughFunction()],
      });

      await workflow.executeAsync();
      expect(workflow.buildSteps.find(s => s.id === 'caller__c')?.getOutputValueByName('out')).toBe(
        'short-long'
      );
    });

    it('resolves caller step references passed through composite function inputs against the caller scope', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/notify': {
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
            uses: './.eas/functions/notify',
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

    it("resolves inner step references in action input defaults against the composite function's own steps", async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/notify': {
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
        steps: [{ uses: './.eas/functions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction(), setVersionFunction()],
      });

      await workflow.executeAsync();

      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('$(echo injected)');
    });

    it('resolves an out-of-scope step reference to an empty value', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/notify': {
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
        steps: [{ uses: './.eas/functions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('');
    });

    it('leaves a legacy step reference in a composite function-scoped value uninterpolated', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/notify': {
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
        steps: [{ uses: './.eas/functions/notify', id: 'notify' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'notify__report')?.getOutputValueByName('out')
      ).toBe('${ steps.checkout.sha }');
    });

    it('resolves a reference to a nested composite function call with no outputs to an empty value', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/inner': {
            runs: {
              steps: [{ id: 'noop', uses: 'test/passthrough', with: { value: 'x' } }],
            },
          },
          './.eas/functions/caller': {
            runs: {
              steps: [
                { uses: './.eas/functions/inner', id: 'nested' },
                {
                  id: 'report',
                  uses: 'test/passthrough',
                  with: { value: '${{ steps.nested.outputs.foo }}' },
                },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/functions/caller', id: 'caller' }],
        externalFunctions: [passThroughFunction()],
      });
      await workflow.executeAsync();
      expect(
        workflow.buildSteps.find(s => s.id === 'caller__report')?.getOutputValueByName('out')
      ).toBe('');
    });
  });
  describe('caller context propagation', () => {
    it('binds composite function inputs into inner function step inputs', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/wrap': {
            inputs: [{ name: 'msg', type: 'string', required: true }],
            runs: {
              steps: [
                { id: 'inner', uses: 'test/passthrough', with: { value: '${{ inputs.msg }}' } },
              ],
            },
          },
        },
        steps: [{ uses: './.eas/functions/wrap', id: 'wrap', with: { msg: 'bound-value' } }],
        externalFunctions: [passThroughFunction()],
      });
      const innerStep = workflow.buildSteps[0];
      expect(innerStep.inputs?.[0].id).toBe('value');
      expect(innerStep.inputs?.[0].rawValue).toBe('${{ inputs.msg }}');

      await workflow.executeAsync();
      expect(innerStep.getOutputValueByName('out')).toBe('bound-value');
    });

    it('propagates caller env to expanded inner steps and keeps only their own if condition', async () => {
      let capturedEnv: Record<string, string | undefined> = {};
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [{ id: 'inner', uses: 'test/capture-env', if: '${{ success() }}' }],
            },
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
        externalFunctions: [captureEnvFunction(env => (capturedEnv = env))],
      });
      const inner = workflow.buildSteps[0];
      expect(inner.ifCondition).toBe('${{ success() }}');
      expect(inner.compositeFunctionScope).toBeDefined();
      await workflow.executeAsync();
      expect(capturedEnv.CALLER).toBe('value');
    });

    it('skips an inner always() step when the caller if condition is false', async () => {
      const workflow = await parseCompositeFunctions({
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

    it('runs a failure()-gated inner step but skips a default-gated one after an earlier workflow failure', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                {
                  id: 'first',
                  uses: 'eas/echo',
                  with: { value: 'cleanup' },
                  if: '${{ failure() }}',
                },
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
      expect(secondStep?.status).toBe(BuildStepStatus.SKIPPED);
    });

    it('skips inner steps of a failure()-gated action when no previous step failed', async () => {
      const workflow = await parseCompositeFunctions({
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
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                { id: 'breaks', uses: 'test/fail', if: '${{ always() }}' },
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
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            runs: {
              steps: [
                { uses: './.eas/functions/inner', id: 'nested' },
                { id: 'after', uses: 'eas/echo', with: { value: 'should not run' } },
              ],
            },
          },
          './.eas/functions/inner': {
            runs: { steps: [{ id: 'breaks', uses: 'test/fail' }] },
          },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'top', if: '${{ always() }}' }],
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const afterStep = workflow.buildSteps.find(s => s.id === 'top__after');
      expect(afterStep?.status).toBe(BuildStepStatus.SKIPPED);
    });

    it('runs an always()-gated inner step of an always()-gated action after earlier workflow failure', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                {
                  id: 'cleanup',
                  uses: 'eas/echo',
                  with: { value: 'cleanup' },
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
        externalFunctions: [failingFunction(), echoFunction()],
      });

      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');

      const cleanupStep = workflow.buildSteps.find(s => s.id === 'setup__cleanup');
      expect(cleanupStep?.status).toBe(BuildStepStatus.SUCCESS);
    });

    it('rejects working_directory on a step that calls a local composite function', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseCompositeFunctions({
          catalog: {
            [SETUP]: {
              runs: { steps: [{ id: 'inner', run: 'echo hi' }] },
            },
          },
          steps: [{ uses: SETUP, id: 'setup', working_directory: 'packages/app' }],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toContain('"working_directory" is not supported on a step that calls');
    });

    it('resolves a templated inner step working_directory in the composite function scope', async () => {
      const workflow = await parseCompositeFunctions({
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
        steps: [{ uses: SETUP, id: 'setup', with: { dir: 'overridden/dir' } }],
        externalFunctions: [passThroughFunction()],
      });
      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('${{ inputs.dir }}');
      await workflow.executeAsync();
      expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('overridden/dir');
    });

    it('preserves the raw inner step if expression through expansion', async () => {
      const workflow = await parseCompositeFunctions({
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

    it.each([
      ['true', BuildStepStatus.SUCCESS],
      ['false', BuildStepStatus.SKIPPED],
    ])(
      'gates an inner step on a composite function input in its if expression (flag=%s)',
      async (flag, expectedStatus) => {
        const workflow = await parseCompositeFunctions({
          catalog: {
            [SETUP]: {
              inputs: [{ name: 'flag', type: 'string', required: true }],
              runs: {
                steps: [
                  {
                    id: 'inner',
                    uses: 'test/passthrough',
                    with: { value: 'ran' },
                    if: '${{ inputs.flag == "true" }}',
                  },
                ],
              },
            },
          },
          steps: [{ uses: SETUP, id: 'setup', with: { flag } }],
          externalFunctions: [passThroughFunction()],
        });
        await workflow.executeAsync();
        expect(workflow.buildSteps.find(s => s.id === 'setup__inner')?.status).toBe(expectedStatus);
      }
    );

    // Action inputs.* are the composite function's inputs (GHA composite), not the step's with.
    it('does not expose an inner function step own with value to its if expression', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                {
                  id: 'inner',
                  uses: 'test/passthrough',
                  with: { value: 'true' },
                  if: '${{ inputs.value == "true" }}',
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
  describe('scoped runtime evaluation', () => {
    it("evaluates the caller if condition against the caller's env overrides", async () => {
      const workflow = await parseCompositeFunctions({
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
        hooks: undefined,
        compositeFunctionCatalog: makeCatalog({
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
      const workflow = await parseCompositeFunctions({
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

    it('uses global success() in input interpolation, matching if condition semantics', async () => {
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
      const workflow = await parseCompositeFunctions({
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
      // Global success() is already false after the earlier failure.
      expect(captured).toBe('ok-false');
    });

    it('resolves success() in a provided with: value against the caller, not the composite function scope', async () => {
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
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'flag', type: 'string', required: false }],
            runs: {
              steps: [
                {
                  id: 'check',
                  uses: 'test/capture',
                  with: { value: '${{ inputs.flag }}' },
                  if: '${{ always() }}',
                },
              ],
            },
          },
        },
        steps: [
          { id: 'fail', uses: 'test/fail' },
          {
            uses: SETUP,
            id: 'setup',
            if: '${{ always() }}',
            with: { flag: 'caller-${{ success() }}' },
          },
        ],
        externalFunctions: [failingFunction(), captureFunction],
      });
      const error = await getErrorAsync<Error>(() => workflow.executeAsync());
      expect(error.message).toBe('inner failed');
      // success() in with: reflects the caller (fail step), not inner action steps.
      expect(captured).toBe('caller-false');
    });

    it("resolves env in a provided with: value against the caller, not an inner step's env overrides", async () => {
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
      const ctx = createGlobalContextMock();
      ctx.updateEnv({ SECRET: 'from-caller' });
      const parser = new StepsConfigParser(ctx, {
        steps: [{ uses: SETUP, id: 'setup', with: { msg: '${{ env.SECRET }}' } }],
        hooks: undefined,
        compositeFunctionCatalog: makeCatalog({
          [SETUP]: {
            inputs: [{ name: 'msg', type: 'string', required: false }],
            runs: {
              steps: [
                {
                  id: 'check',
                  uses: 'test/capture',
                  env: { SECRET: 'from-inner' },
                  with: { value: '${{ inputs.msg }}' },
                },
              ],
            },
          },
        }),
        externalFunctions: [captureFunction],
      });
      const workflow = await parser.parseAsync();
      await workflow.executeAsync();
      expect(captured).toBe('from-caller');
    });

    it('resolves a default value env against the composite function boundary, stable across inner steps that override the key', async () => {
      const captured: unknown[] = [];
      const captureFunction = new BuildFunction({
        namespace: 'test',
        id: 'capture',
        fn: (_ctx, { inputs }) => {
          captured.push(inputs.value.value);
        },
        inputProviders: [
          BuildStepInput.createProvider({
            id: 'value',
            allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            required: false,
          }),
        ],
      });
      const ctx = createGlobalContextMock();
      ctx.updateEnv({ NAME: 'boundary' });
      const parser = new StepsConfigParser(ctx, {
        steps: [{ uses: SETUP, id: 'setup' }],
        hooks: undefined,
        compositeFunctionCatalog: makeCatalog({
          [SETUP]: {
            inputs: [{ name: 'label', type: 'string', default_value: '${{ env.NAME }}' }],
            runs: {
              steps: [
                {
                  id: 'first',
                  uses: 'test/capture',
                  env: { NAME: 'alice' },
                  with: { value: '${{ inputs.label }}' },
                },
                {
                  id: 'second',
                  uses: 'test/capture',
                  env: { NAME: 'bob' },
                  with: { value: '${{ inputs.label }}' },
                },
              ],
            },
          },
        }),
        externalFunctions: [captureFunction],
      });
      const workflow = await parser.parseAsync();
      await workflow.executeAsync();
      expect(captured).toEqual(['boundary', 'boundary']);
    });
  });
  describe('bare if conditions', () => {
    it('substitutes composite function inputs in bare inner if expressions', async () => {
      const workflow = await parseCompositeFunctions({
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
      const workflow = await parseCompositeFunctions({
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
      const workflow = await parseCompositeFunctions({
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
  describe('lifted restrictions and runtime resolution', () => {
    it('resolves an input whose value mixes text with an expression, used inside an inner expression', async () => {
      const workflow = await parseCompositeFunctions({
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
      const workflow = await parseCompositeFunctions({
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
      const workflow = await parseCompositeFunctions({
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
      const workflow = await parseCompositeFunctions({
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

    it('skips the allowed_values check for a reference-valued constrained input', async () => {
      const makeWorkflow = (provided: string): Promise<BuildWorkflow> =>
        parseCompositeFunctions({
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

      for (const provided of ['prod', 'staging']) {
        const workflow = await makeWorkflow(provided);
        await workflow.executeAsync();
        expect(
          workflow.buildSteps.find(s => s.id === 'setup__show')?.getOutputValueByName('out')
        ).toBe(provided);
      }
    });

    it('resolves an expression-valued env override into the process env', async () => {
      let capturedEnv: Record<string, string | undefined> = {};
      const workflow = await parseCompositeFunctions({
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

    it('resolves a call-site env template against the caller scope, not the composite function scope', async () => {
      let capturedEnv: Record<string, string | undefined> = {};
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: { steps: [{ id: 'read', uses: 'test/capture-env' }] },
          },
        },
        steps: [
          { id: 'prev', uses: 'test/passthrough', with: { value: 'from-caller' } },
          {
            uses: SETUP,
            id: 'setup',
            env: { TOKEN: '${{ steps.prev.outputs.out }}' },
          },
        ],
        externalFunctions: [passThroughFunction(), captureEnvFunction(env => (capturedEnv = env))],
      });
      await workflow.executeAsync();

      expect(capturedEnv.TOKEN).toBe('from-caller');
    });

    it('rejects working_directory on a nested step that calls another action', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseCompositeFunctions({
          catalog: {
            './.eas/functions/outer': {
              runs: {
                steps: [
                  {
                    uses: './.eas/functions/inner',
                    id: 'inner',
                    working_directory: 'packages/app',
                  },
                ],
              },
            },
            './.eas/functions/inner': {
              runs: { steps: [{ id: 'read', uses: 'test/passthrough', with: { value: 'ok' } }] },
            },
          },
          steps: [{ uses: './.eas/functions/outer', id: 'outer' }],
          externalFunctions: [passThroughFunction()],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toContain('"working_directory" is not supported on a step that calls');
    });

    it('resolves a nested call-site env template against the outer composite function inputs', async () => {
      let capturedEnv: Record<string, string | undefined> = {};
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            inputs: [{ name: 'token', type: 'string' }],
            runs: {
              steps: [
                {
                  uses: './.eas/functions/inner',
                  id: 'inner',
                  env: { TOKEN: '${{ inputs.token }}' },
                },
              ],
            },
          },
          './.eas/functions/inner': {
            runs: { steps: [{ id: 'read', uses: 'test/capture-env' }] },
          },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'outer', with: { token: 'secret' } }],
        externalFunctions: [captureEnvFunction(env => (capturedEnv = env))],
      });
      await workflow.executeAsync();

      expect(capturedEnv.TOKEN).toBe('secret');
    });

    it('throws a runtime error when an input default references itself indirectly', async () => {
      const workflow = await parseCompositeFunctions({
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

    it('resolves nested action if and with against the outer composite function inputs at runtime', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/wrap': {
            inputs: [
              { name: 'flag', type: 'string' },
              { name: 'msg', type: 'string' },
            ],
            runs: {
              steps: [
                {
                  uses: './.eas/functions/inner',
                  id: 'inner',
                  if: '${{ inputs.flag == "go" }}',
                  with: { text: '${{ inputs.msg }}' },
                },
              ],
            },
          },
          './.eas/functions/inner': {
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
            uses: './.eas/functions/wrap',
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
