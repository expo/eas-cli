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
    hooks: undefined,
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

  describe('step reference scoping', () => {
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
  });

  describe('caller context propagation', () => {
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
        hooks: undefined,
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
      expect(error.errors[0].message).toBe('Duplicated step IDs: "setup__read"');
    });
  });
});
