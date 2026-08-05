import fs from 'fs/promises';

import { Hooks, Step } from '@expo/eas-build-job';

import { makeCatalog } from './StepsConfigParser-composite-functions-test-utils';
import { createGlobalContextMock } from './utils/context';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepStatus } from '../BuildStep';
import { BuildStepGlobalContext } from '../BuildStepContext';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildStepOutput } from '../BuildStepOutput';
import { BuildWorkflow } from '../BuildWorkflow';
import { StepsConfigParser } from '../StepsConfigParser';
import { WorkflowHookMetric } from '../StepMetrics';
import { BuildStepRuntimeError } from '../errors';

describe('BuildWorkflow hook execution', () => {
  let ctx: BuildStepGlobalContext;
  let executionLog: string[];
  let metrics: WorkflowHookMetric[];

  beforeEach(async () => {
    executionLog = [];
    metrics = [];
    ctx = createGlobalContextMock({
      reportWorkflowHookMetric: metric => metrics.push(metric),
    });
    await fs.mkdir(ctx.defaultWorkingDirectory, { recursive: true });
    await fs.mkdir(ctx.stepsInternalBuildDirectory, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(ctx.stepsInternalBuildDirectory, { recursive: true, force: true });
    await fs.rm(ctx.defaultWorkingDirectory, { recursive: true, force: true });
  });

  function recordingFunction(id: string, { failWith }: { failWith?: unknown } = {}): BuildFunction {
    return new BuildFunction({
      namespace: 'test',
      id,
      fn: () => {
        executionLog.push(id);
        if (failWith !== undefined) {
          throw failWith;
        }
      },
    });
  }

  function anchorFunction(): BuildFunction {
    return new BuildFunction({
      namespace: 'eas',
      id: 'install_node_modules',
      name: 'Install node modules',
      fn: () => {
        executionLog.push('anchor');
      },
      __hookId: 'install_node_modules',
    });
  }

  function failingAnchorFunction(): BuildFunction {
    return new BuildFunction({
      namespace: 'eas',
      id: 'install_node_modules',
      name: 'Install node modules',
      fn: () => {
        executionLog.push('anchor');
        throw new Error('anchor failed');
      },
      __hookId: 'install_node_modules',
    });
  }

  function versionFunction(id: string, version: string): BuildFunction {
    return new BuildFunction({
      namespace: 'test',
      id,
      fn: (_ctx, { outputs }) => {
        executionLog.push(id);
        outputs.version.set(version);
      },
      outputProviders: [BuildStepOutput.createProvider({ id: 'version', required: true })],
    });
  }

  function captureFunction(id: string, sink: (value: unknown) => void): BuildFunction {
    return new BuildFunction({
      namespace: 'test',
      id,
      fn: (_ctx, { inputs }) => {
        executionLog.push(id);
        sink(inputs.value.value);
      },
      inputProviders: [
        BuildStepInput.createProvider({
          id: 'value',
          required: false,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
      ],
    });
  }

  async function parseAsync({
    steps,
    hooks,
    externalFunctions,
    externalFunctionGroups,
    compositeFunctionCatalog,
  }: {
    steps: Step[];
    hooks: Hooks | undefined;
    externalFunctions: BuildFunction[];
    externalFunctionGroups?: BuildFunctionGroup[];
    compositeFunctionCatalog?: Record<string, unknown>;
  }): Promise<BuildWorkflow> {
    const parser = new StepsConfigParser(ctx, {
      steps,
      hooks,
      externalFunctions,
      externalFunctionGroups,
      localFunctionCatalog: compositeFunctionCatalog
        ? makeCatalog(compositeFunctionCatalog)
        : undefined,
    });
    return await parser.parseAsync();
  }

  function hookStepStatuses(workflow: BuildWorkflow): Record<string, BuildStepStatus> {
    const statuses: Record<string, BuildStepStatus> = {};
    for (const anchorHooks of workflow.hooksByAnchorStep.values()) {
      for (const entry of [...anchorHooks.before, ...anchorHooks.after]) {
        for (const step of entry.steps) {
          statuses[step.id] = step.status;
        }
      }
    }
    return statuses;
  }

  describe('hooks run iff the anchor runs', () => {
    it('skips before AND after hooks (displayed as skipped) when the anchor if: is false', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules', if: '${{ false }}' }],
        hooks: {
          before_install_node_modules: [{ uses: 'test/before', id: 'before-hook' }],
          after_install_node_modules: [{ uses: 'test/after', id: 'after-hook' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('before'),
          recordingFunction('after'),
        ],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual([]);
      expect(hookStepStatuses(workflow)).toEqual({
        'before-hook': BuildStepStatus.SKIPPED,
        'after-hook': BuildStepStatus.SKIPPED,
      });
    });

    it('never runs hooks of a skipped anchor, even with if: always() on the hook step', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules', if: '${{ false }}' }],
        hooks: {
          after_install_node_modules: [
            { uses: 'test/after', id: 'after-hook', if: '${{ always() }}' },
          ],
        },
        externalFunctions: [anchorFunction(), recordingFunction('after')],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual([]);
      expect(hookStepStatuses(workflow)['after-hook']).toBe(BuildStepStatus.SKIPPED);
    });
  });

  describe('the always() matrix (baseline failure is ignored, in-sequence failure is not)', () => {
    it('runs no-if before hooks when the anchor runs past a prior failure via always()', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'test/boom' }, { uses: 'eas/install_node_modules', if: '${{ always() }}' }],
        hooks: {
          before_install_node_modules: [{ uses: 'test/before', id: 'before-hook' }],
          after_install_node_modules: [{ uses: 'test/after', id: 'after-hook' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('boom', { failWith: new Error('boom failed') }),
          recordingFunction('before'),
          recordingFunction('after'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('boom failed');
      expect(executionLog).toEqual(['boom', 'before', 'anchor', 'after']);
    });

    it('a before hook failing IN the sequence skips subsequent no-if before entries, the anchor, and after hooks', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: 'test/failing-before', id: 'failing-before' },
            { uses: 'test/second-before', id: 'second-before' },
          ],
          after_install_node_modules: [{ uses: 'test/after', id: 'after-hook' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('failing-before', { failWith: new Error('before failed') }),
          recordingFunction('second-before'),
          recordingFunction('after'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('before failed');
      expect(executionLog).toEqual(['failing-before']);
      const statuses = hookStepStatuses(workflow);
      expect(statuses['second-before']).toBe(BuildStepStatus.SKIPPED);
      expect(statuses['after-hook']).toBe(BuildStepStatus.SKIPPED);
      expect(workflow.buildSteps[0].status).toBe(BuildStepStatus.SKIPPED);
    });

    it('failure() and success() on hook steps keep their global meaning', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'test/boom' }, { uses: 'eas/install_node_modules', if: '${{ always() }}' }],
        hooks: {
          before_install_node_modules: [
            { uses: 'test/on-failure', id: 'on-failure', if: '${{ failure() }}' },
            { uses: 'test/on-success', id: 'on-success', if: '${{ success() }}' },
          ],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('boom', { failWith: new Error('boom failed') }),
          recordingFunction('on-failure'),
          recordingFunction('on-success'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('boom failed');
      expect(executionLog).toEqual(['boom', 'on-failure', 'anchor']);
      expect(hookStepStatuses(workflow)['on-success']).toBe(BuildStepStatus.SKIPPED);
    });
  });

  describe('after hooks on anchor failure', () => {
    it('runs no-if and failure() after hooks past a failed anchor; success() skips', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [
            { uses: 'test/no-if', id: 'no-if' },
            { uses: 'test/on-success', id: 'on-success', if: '${{ success() }}' },
            { uses: 'test/on-failure', id: 'on-failure', if: '${{ failure() }}' },
          ],
        },
        externalFunctions: [
          failingAnchorFunction(),
          recordingFunction('no-if'),
          recordingFunction('on-success'),
          recordingFunction('on-failure'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('anchor failed');
      expect(executionLog).toEqual(['anchor', 'no-if', 'on-failure']);
      expect(hookStepStatuses(workflow)['on-success']).toBe(BuildStepStatus.SKIPPED);
    });

    it("the anchor's error outranks a failed after hook's error", async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [{ uses: 'test/failing-after', id: 'failing-after' }],
        },
        externalFunctions: [
          failingAnchorFunction(),
          recordingFunction('failing-after', { failWith: new Error('after failed') }),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('anchor failed');
      expect(executionLog).toEqual(['anchor', 'failing-after']);
    });

    it('an earlier failed after entry does not stop later no-if after entries (after-chain continuation)', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [
            { uses: 'test/failing-after', id: 'failing-after' },
            { uses: 'test/second-after', id: 'second-after' },
          ],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('failing-after', { failWith: new Error('after failed') }),
          recordingFunction('second-after'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('after failed');
      expect(executionLog).toEqual(['anchor', 'failing-after', 'second-after']);
    });

    it('a green anchor with a failed after hook fails the job with the after hook error', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [{ uses: 'test/failing-after', id: 'failing-after' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('failing-after', { failWith: new Error('after failed') }),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('after failed');
      expect(executionLog).toEqual(['anchor', 'failing-after']);
    });
  });

  describe('before hook shell semantics', () => {
    it('a hook step failure suppressed with || true keeps the anchor running', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [{ run: 'false || true', id: 'suppressed' }],
        },
        externalFunctions: [anchorFunction()],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['anchor']);
    });
  });

  describe('anchor gate errors', () => {
    it('a throwing anchor if: marks the job failed, skips the anchor and its hooks, and later failure() steps still run', async () => {
      const workflow = await parseAsync({
        steps: [
          { uses: 'eas/install_node_modules', if: '${{ nonexistent.object.property }}' },
          { uses: 'test/cleanup', id: 'cleanup', if: '${{ failure() }}' },
        ],
        hooks: {
          before_install_node_modules: [{ uses: 'test/before', id: 'before-hook' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('before'),
          recordingFunction('cleanup'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow();
      expect(executionLog).toEqual(['cleanup']);
      expect(hookStepStatuses(workflow)['before-hook']).toBe(BuildStepStatus.SKIPPED);
    });
  });

  describe('dormancy and the falsy-throw bugfix', () => {
    it('a hookless workflow executes as before', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'test/one' }, { uses: 'test/two' }],
        hooks: undefined,
        externalFunctions: [recordingFunction('one'), recordingFunction('two')],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['one', 'two']);
      expect(metrics).toEqual([]);
    });

    it('a step throwing a falsy value fails the job with a descriptive wrapped error', async () => {
      const workflow = await parseAsync({
        steps: [
          { uses: 'test/falsy-boom' },
          { uses: 'test/skipped-after', id: 'skipped-after' },
          { uses: 'test/cleanup', if: '${{ failure() }}' },
        ],
        hooks: undefined,
        externalFunctions: [
          new BuildFunction({
            namespace: 'test',
            id: 'falsy-boom',
            fn: () => {
              executionLog.push('falsy-boom');
              return Promise.reject(undefined);
            },
          }),
          recordingFunction('skipped-after'),
          recordingFunction('cleanup'),
        ],
      });
      const execution = workflow.executeAsync();
      await expect(execution).rejects.toBeInstanceOf(BuildStepRuntimeError);
      await expect(execution).rejects.toThrow('threw a non-Error value: undefined');
      expect(executionLog).toEqual(['falsy-boom', 'cleanup']);
    });

    it('the first failure wins even when it was a falsy throw', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'test/falsy-boom' }, { uses: 'test/late-boom', if: '${{ always() }}' }],
        hooks: undefined,
        externalFunctions: [
          new BuildFunction({
            namespace: 'test',
            id: 'falsy-boom',
            fn: () => Promise.reject(undefined),
          }),
          new BuildFunction({
            namespace: 'test',
            id: 'late-boom',
            fn: () => {
              throw new Error('later');
            },
          }),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('threw a non-Error value');
    });
  });

  describe('group hook entries', () => {
    function createGroup(
      id: string,
      childIds: string[]
    ): {
      group: BuildFunctionGroup;
      functions: BuildFunction[];
    } {
      const functions = childIds.map(childId => recordingFunction(childId));
      return {
        group: new BuildFunctionGroup({
          namespace: 'test',
          id,
          createBuildStepsFromFunctionGroupCall: globalCtx =>
            functions.map(fn => fn.createBuildStepFromFunctionCall(globalCtx)),
        }),
        functions,
      };
    }

    it('executes a function group in an after hook', async () => {
      const { group, functions } = createGroup('group', ['child-one', 'child-two']);
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: 'test/group' }] },
        externalFunctions: [anchorFunction(), ...functions],
        externalFunctionGroups: [group],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['anchor', 'child-one', 'child-two']);
    });

    it('a group hook entry with if: false executes NOTHING (entry-level ifCondition)', async () => {
      const { group, functions } = createGroup('group', ['child-one', 'child-two']);
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: 'test/group', if: '${{ false }}' }] },
        externalFunctions: [anchorFunction(), ...functions],
        externalFunctionGroups: [group],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['anchor']);
      const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
      for (const step of anchorHooks.before[0].steps) {
        expect(step.status).toBe(BuildStepStatus.SKIPPED);
      }
    });

    it('a group entry whose if: passes runs its steps past an earlier entry failure', async () => {
      const { group, functions } = createGroup('group', ['child-one', 'child-two']);
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: 'test/failing-before', id: 'failing-before' },
            { uses: 'test/group', if: '${{ always() }}' },
          ],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('failing-before', { failWith: new Error('before failed') }),
          ...functions,
        ],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('before failed');
      expect(executionLog).toEqual(['failing-before', 'child-one', 'child-two']);
      // ONE event for the whole before side, with the side's aggregated
      // result (the first entry failed); the skipped anchor reports nothing.
      expect(metrics).toEqual([
        {
          anchor: 'install_node_modules',
          timing: 'before',
          result: 'failed',
        },
      ]);
    });

    it('within a single after entry, a failed sibling skips later no-if siblings', async () => {
      const failingChild = recordingFunction('failing-child', {
        failWith: new Error('child failed'),
      });
      const okChild = recordingFunction('ok-child');
      const group = new BuildFunctionGroup({
        namespace: 'test',
        id: 'group',
        createBuildStepsFromFunctionGroupCall: globalCtx => [
          failingChild.createBuildStepFromFunctionCall(globalCtx, { id: 'failing-child' }),
          okChild.createBuildStepFromFunctionCall(globalCtx, { id: 'ok-child' }),
        ],
      });
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: 'test/group' }] },
        externalFunctions: [anchorFunction(), failingChild, okChild],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('child failed');
      expect(executionLog).toEqual(['anchor', 'failing-child']);
      expect(hookStepStatuses(workflow)['ok-child']).toBe(BuildStepStatus.SKIPPED);
    });

    it('a failed after group entry does not stop a later no-if after entry', async () => {
      const failingChild = recordingFunction('failing-child', {
        failWith: new Error('child failed'),
      });
      const okChild = recordingFunction('ok-child');
      const group = new BuildFunctionGroup({
        namespace: 'test',
        id: 'group',
        createBuildStepsFromFunctionGroupCall: globalCtx => [
          failingChild.createBuildStepFromFunctionCall(globalCtx, { id: 'failing-child' }),
          okChild.createBuildStepFromFunctionCall(globalCtx, { id: 'ok-child' }),
        ],
      });
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [
            { uses: 'test/group' },
            { uses: 'test/next-entry', id: 'next-entry' },
          ],
        },
        externalFunctions: [
          anchorFunction(),
          failingChild,
          okChild,
          recordingFunction('next-entry'),
        ],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('child failed');
      expect(executionLog).toEqual(['anchor', 'failing-child', 'next-entry']);
      expect(hookStepStatuses(workflow)['ok-child']).toBe(BuildStepStatus.SKIPPED);
    });

    it('within an after entry whose if: passed, a failed sibling skips later no-if siblings', async () => {
      const failingChild = recordingFunction('failing-child', {
        failWith: new Error('child failed'),
      });
      const okChild = recordingFunction('ok-child');
      const group = new BuildFunctionGroup({
        namespace: 'test',
        id: 'group',
        createBuildStepsFromFunctionGroupCall: globalCtx => [
          failingChild.createBuildStepFromFunctionCall(globalCtx, { id: 'failing-child' }),
          okChild.createBuildStepFromFunctionCall(globalCtx, { id: 'ok-child' }),
        ],
      });
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: 'test/group', if: '${{ always() }}' }] },
        externalFunctions: [anchorFunction(), failingChild, okChild],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('child failed');
      expect(executionLog).toEqual(['anchor', 'failing-child']);
      expect(hookStepStatuses(workflow)['ok-child']).toBe(BuildStepStatus.SKIPPED);
    });

    it('within a before entry whose if: passed, a failed sibling skips later no-if siblings', async () => {
      const failingChild = recordingFunction('failing-child', {
        failWith: new Error('child failed'),
      });
      const okChild = recordingFunction('ok-child');
      const group = new BuildFunctionGroup({
        namespace: 'test',
        id: 'group',
        createBuildStepsFromFunctionGroupCall: globalCtx => [
          failingChild.createBuildStepFromFunctionCall(globalCtx, { id: 'failing-child' }),
          okChild.createBuildStepFromFunctionCall(globalCtx, { id: 'ok-child' }),
        ],
      });
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: 'test/group', if: '${{ always() }}' }] },
        externalFunctions: [anchorFunction(), failingChild, okChild],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('child failed');
      expect(executionLog).toEqual(['failing-child']);
      expect(hookStepStatuses(workflow)['ok-child']).toBe(BuildStepStatus.SKIPPED);
    });

    it('an entry-level condition evaluation error fails the hook (and the job), not silently ignored', async () => {
      const { group, functions } = createGroup('group', ['child-one']);
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: 'test/group', if: '${{ nonexistent.object.property }}' },
          ],
        },
        externalFunctions: [anchorFunction(), ...functions],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow();
      expect(executionLog).toEqual([]);
      expect(workflow.buildSteps[0].status).toBe(BuildStepStatus.SKIPPED);
    });
  });

  describe('composite function hook entries', () => {
    it('runs composite children in order in a before hook and collects the declared outputs', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }] },
        externalFunctions: [
          anchorFunction(),
          versionFunction('read-version', '1.2.3'),
          recordingFunction('second-child'),
        ],
        compositeFunctionCatalog: {
          './.eas/functions/setup': {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: {
              steps: [
                { id: 'read', uses: 'test/read-version' },
                { id: 'second', uses: 'test/second-child' },
              ],
            },
          },
        },
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['read-version', 'second-child', 'anchor']);
      const entry = [...workflow.hooksByAnchorStep.values()][0].before[0];
      const outputsNode = entry.steps[entry.steps.length - 1];
      expect(outputsNode.id).toBe('setup');
      expect(outputsNode.getOutputValueByName('version')).toBe('1.2.3');
      expect(metrics).toEqual([
        { anchor: 'install_node_modules', timing: 'before', result: 'success' },
      ]);
    });

    it('skips every step of a composite call whose if condition is false and reports no metric', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: './.eas/functions/setup', id: 'setup', if: '${{ false }}' },
          ],
        },
        externalFunctions: [anchorFunction(), versionFunction('read-version', '1.2.3')],
        compositeFunctionCatalog: {
          './.eas/functions/setup': {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: { steps: [{ id: 'read', uses: 'test/read-version' }] },
          },
        },
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['anchor']);
      const entry = [...workflow.hooksByAnchorStep.values()][0].before[0];
      for (const step of entry.steps) {
        expect(step.status).toBe(BuildStepStatus.SKIPPED);
      }
      expect(metrics).toEqual([]);
    });

    it('reports no metric when every authored child of an outputs-declaring composite is skipped', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }] },
        externalFunctions: [anchorFunction(), versionFunction('read-version', '1.2.3')],
        compositeFunctionCatalog: {
          './.eas/functions/setup': {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: { steps: [{ id: 'read', uses: 'test/read-version', if: '${{ false }}' }] },
          },
        },
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['anchor']);
      expect(hookStepStatuses(workflow)['setup__read']).toBe(BuildStepStatus.SKIPPED);
      // The synthetic outputs node still runs under always(); only the metric
      // must not depend on it.
      const entry = [...workflow.hooksByAnchorStep.values()][0].before[0];
      const outputsNode = entry.steps[entry.steps.length - 1];
      expect(outputsNode.status).toBe(BuildStepStatus.SUCCESS);
      expect(metrics).toEqual([]);
    });

    it('after a failed anchor, runs composite children unless they require success() and still collects outputs', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [{ uses: './.eas/functions/cleanup', id: 'cleanup' }],
        },
        externalFunctions: [
          failingAnchorFunction(),
          recordingFunction('no-if-child'),
          recordingFunction('on-success'),
          versionFunction('always-version', '9.9.9'),
        ],
        compositeFunctionCatalog: {
          './.eas/functions/cleanup': {
            outputs: { last: { value: '${{ steps.always.outputs.version }}' } },
            runs: {
              steps: [
                { id: 'first', uses: 'test/no-if-child' },
                { id: 'skipped', uses: 'test/on-success', if: '${{ success() }}' },
                { id: 'always', uses: 'test/always-version', if: '${{ always() }}' },
              ],
            },
          },
        },
      });
      await expect(workflow.executeAsync()).rejects.toThrow('anchor failed');
      expect(executionLog).toEqual(['anchor', 'no-if-child', 'always-version']);
      expect(hookStepStatuses(workflow)['cleanup__skipped']).toBe(BuildStepStatus.SKIPPED);
      const entry = [...workflow.hooksByAnchorStep.values()][0].after[0];
      const outputsNode = entry.steps[entry.steps.length - 1];
      expect(outputsNode.getOutputValueByName('last')).toBe('9.9.9');
    });

    it('when a composite child fails, skips later children unless they have always() and still collects outputs', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }] },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('boom-child', { failWith: new Error('child failed') }),
          recordingFunction('after-boom'),
          recordingFunction('always-child'),
        ],
        compositeFunctionCatalog: {
          './.eas/functions/setup': {
            outputs: { note: { value: 'done' } },
            runs: {
              steps: [
                { id: 'boom', uses: 'test/boom-child' },
                { id: 'skipped', uses: 'test/after-boom' },
                { id: 'always', uses: 'test/always-child', if: '${{ always() }}' },
              ],
            },
          },
        },
      });
      await expect(workflow.executeAsync()).rejects.toThrow('child failed');
      expect(executionLog).toEqual(['boom-child', 'always-child']);
      const statuses = hookStepStatuses(workflow);
      expect(statuses['setup__skipped']).toBe(BuildStepStatus.SKIPPED);
      expect(statuses['setup']).toBe(BuildStepStatus.SUCCESS);
      const entry = [...workflow.hooksByAnchorStep.values()][0].before[0];
      expect(entry.steps[entry.steps.length - 1].getOutputValueByName('note')).toBe('done');
      expect(workflow.buildSteps[0].status).toBe(BuildStepStatus.SKIPPED);
    });

    it('when an after composite child fails, skips later children unless they have always() and still collects outputs', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [{ uses: './.eas/functions/publish', id: 'publish' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('login', { failWith: new Error('login failed') }),
          recordingFunction('push'),
          recordingFunction('always-child'),
        ],
        compositeFunctionCatalog: {
          './.eas/functions/publish': {
            outputs: { note: { value: 'done' } },
            runs: {
              steps: [
                { id: 'login', uses: 'test/login' },
                { id: 'push', uses: 'test/push' },
                { id: 'always', uses: 'test/always-child', if: '${{ always() }}' },
              ],
            },
          },
        },
      });
      await expect(workflow.executeAsync()).rejects.toThrow('login failed');
      expect(executionLog).toEqual(['anchor', 'login', 'always-child']);
      const statuses = hookStepStatuses(workflow);
      expect(statuses['publish__push']).toBe(BuildStepStatus.SKIPPED);
      expect(statuses['publish']).toBe(BuildStepStatus.SUCCESS);
      const entry = [...workflow.hooksByAnchorStep.values()][0].after[0];
      expect(entry.steps[entry.steps.length - 1].getOutputValueByName('note')).toBe('done');
    });

    it('skips the whole composite entry, including its always() children, when an earlier hook entry fails', async () => {
      // Memoized call gate: unlike an inline always() hook step, always() children
      // inside the composite also skip once the call is inactive.
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: 'test/first-boom', id: 'first-boom' },
            { uses: './.eas/functions/setup', id: 'setup' },
          ],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('first-boom', { failWith: new Error('first failed') }),
          recordingFunction('plain-child'),
          recordingFunction('always-child'),
        ],
        compositeFunctionCatalog: {
          './.eas/functions/setup': {
            outputs: { note: { value: 'done' } },
            runs: {
              steps: [
                { id: 'plain', uses: 'test/plain-child' },
                { id: 'always', uses: 'test/always-child', if: '${{ always() }}' },
              ],
            },
          },
        },
      });
      await expect(workflow.executeAsync()).rejects.toThrow('first failed');
      expect(executionLog).toEqual(['first-boom']);
      const statuses = hookStepStatuses(workflow);
      expect(statuses['setup__plain']).toBe(BuildStepStatus.SKIPPED);
      expect(statuses['setup__always']).toBe(BuildStepStatus.SKIPPED);
      expect(statuses['setup']).toBe(BuildStepStatus.SKIPPED);
    });

    it('a later hook step consumes the composite call outputs via steps.<call-id>', async () => {
      const captured: unknown[] = [];
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: './.eas/functions/setup', id: 'setup' },
            {
              id: 'consume',
              uses: 'test/consume',
              with: { value: '${{ steps.setup.outputs.version }}' },
            },
          ],
        },
        externalFunctions: [
          anchorFunction(),
          versionFunction('read-version', '1.2.3'),
          captureFunction('consume', value => captured.push(value)),
        ],
        compositeFunctionCatalog: {
          './.eas/functions/setup': {
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: { steps: [{ id: 'read', uses: 'test/read-version' }] },
          },
        },
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['read-version', 'consume', 'anchor']);
      expect(captured).toEqual(['1.2.3']);
    });
  });

  describe('the eas.workflow.hook metric callback', () => {
    it('reports one event per executed hook side with anchor, timing, and result', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [{ run: 'true', id: 'run-before' }],
          after_install_node_modules: [{ uses: 'test/after', id: 'uses-after' }],
        },
        externalFunctions: [anchorFunction(), recordingFunction('after')],
      });
      await workflow.executeAsync();
      expect(metrics).toEqual([
        {
          anchor: 'install_node_modules',
          timing: 'before',
          result: 'success',
        },
        {
          anchor: 'install_node_modules',
          timing: 'after',
          result: 'success',
          anchorResult: 'success',
        },
      ]);
    });

    it('reports nothing for skipped hooks', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules', if: '${{ false }}' }],
        hooks: {
          before_install_node_modules: [{ uses: 'test/before', id: 'before-hook' }],
          after_install_node_modules: [{ uses: 'test/after', id: 'after-hook' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('before'),
          recordingFunction('after'),
        ],
      });
      await workflow.executeAsync();
      expect(metrics).toEqual([]);
    });

    it('tags after events with the anchor LOCAL outcome: failed anchor', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: 'test/after', id: 'after-hook' }] },
        externalFunctions: [failingAnchorFunction(), recordingFunction('after')],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('anchor failed');
      expect(metrics).toEqual([
        {
          anchor: 'install_node_modules',
          timing: 'after',
          result: 'success',
          anchorResult: 'failed',
        },
      ]);
    });

    it('tags anchorResult success for an always() anchor executing green past an unrelated failure', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'test/boom' }, { uses: 'eas/install_node_modules', if: '${{ always() }}' }],
        hooks: { after_install_node_modules: [{ uses: 'test/after', id: 'after-hook' }] },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('boom', { failWith: new Error('boom failed') }),
          recordingFunction('after'),
        ],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('boom failed');
      expect(metrics).toEqual([
        {
          anchor: 'install_node_modules',
          timing: 'after',
          result: 'success',
          anchorResult: 'success',
        },
      ]);
    });

    it('a multi-child group hook reports exactly ONE event with the aggregated result', async () => {
      const failingChild = new BuildFunction({
        namespace: 'test',
        id: 'failing-child',
        fn: () => {
          executionLog.push('failing-child');
          throw new Error('child failed');
        },
      });
      const okChild = recordingFunction('ok-child');
      const group = new BuildFunctionGroup({
        namespace: 'test',
        id: 'group',
        // The failing child comes FIRST: within-entry fail-fast skips
        // ok-child, and the single event still reports the aggregated failure.
        createBuildStepsFromFunctionGroupCall: globalCtx => [
          failingChild.createBuildStepFromFunctionCall(globalCtx),
          okChild.createBuildStepFromFunctionCall(globalCtx),
        ],
      });
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: 'test/group' }] },
        externalFunctions: [anchorFunction(), okChild, failingChild],
        externalFunctionGroups: [group],
      });
      await expect(workflow.executeAsync()).rejects.toThrow('child failed');
      expect(executionLog).toEqual(['anchor', 'failing-child']);
      expect(metrics).toEqual([
        {
          anchor: 'install_node_modules',
          timing: 'after',
          result: 'failed',
          anchorResult: 'success',
        },
      ]);
    });
  });

  describe('execution order', () => {
    it('executes multi-occurrence wraps in order, each occurrence with its own hooks', async () => {
      const workflow = await parseAsync({
        steps: [{ uses: 'eas/install_node_modules' }, { uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [{ uses: 'test/before' }],
          after_install_node_modules: [{ uses: 'test/after' }],
        },
        externalFunctions: [
          anchorFunction(),
          recordingFunction('before'),
          recordingFunction('after'),
        ],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['before', 'anchor', 'after', 'before', 'anchor', 'after']);
    });

    it('executes hooks around an anchored function inside a group expansion', async () => {
      const anchor = anchorFunction();
      const plain = recordingFunction('plain');
      const group = new BuildFunctionGroup({
        namespace: 'test',
        id: 'group',
        createBuildStepsFromFunctionGroupCall: globalCtx => [
          plain.createBuildStepFromFunctionCall(globalCtx),
          anchor.createBuildStepFromFunctionCall(globalCtx),
        ],
      });
      const workflow = await parseAsync({
        steps: [{ uses: 'test/group' }],
        hooks: {
          before_install_node_modules: [{ uses: 'test/before' }],
          after_install_node_modules: [{ uses: 'test/after' }],
        },
        externalFunctions: [anchor, plain, recordingFunction('before'), recordingFunction('after')],
        externalFunctionGroups: [group],
      });
      await workflow.executeAsync();
      expect(executionLog).toEqual(['plain', 'before', 'anchor', 'after']);
    });
  });
});
