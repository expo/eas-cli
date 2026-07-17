import { CompositeFunctionCatalog, Hooks, Step } from '@expo/eas-build-job';

import { makeCatalog } from './StepsConfigParser-composite-functions-test-utils';
import { createGlobalContextMock } from './utils/context';
import { getErrorAsync } from './utils/error';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildRuntimePlatform } from '../BuildRuntimePlatform';
import { BuildStepGlobalContext } from '../BuildStepContext';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildWorkflow } from '../BuildWorkflow';
import { StepsConfigParser } from '../StepsConfigParser';
import { BuildConfigError, BuildWorkflowError } from '../errors';
import { constructHookEntriesAsync, validateHookStepsAsync } from '../hooks';

function createInstallNodeModulesFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_node_modules',
    name: 'Install node modules',
    command: 'npm install',
    __hookId: 'install_node_modules',
  });
}

function createCheckoutFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'checkout',
    name: 'Checkout',
    command: 'echo checkout',
    __hookId: 'checkout',
  });
}

async function parseWorkflowAsync({
  ctx,
  steps,
  hooks,
  externalFunctions,
  externalFunctionGroups,
  compositeFunctionCatalog,
}: {
  ctx: BuildStepGlobalContext;
  steps: Step[];
  hooks: Hooks | undefined;
  externalFunctions?: BuildFunction[];
  externalFunctionGroups?: BuildFunctionGroup[];
  compositeFunctionCatalog?: CompositeFunctionCatalog;
}): Promise<BuildWorkflow> {
  const parser = new StepsConfigParser(ctx, {
    steps,
    hooks,
    externalFunctions: externalFunctions ?? [
      createInstallNodeModulesFunction(),
      createCheckoutFunction(),
    ],
    externalFunctionGroups,
    compositeFunctionCatalog,
  });
  return await parser.parseAsync();
}

function orderedDisplayNames(workflow: BuildWorkflow): string[] {
  return workflow.getExecutionOrderedSteps().map(step => step.displayName);
}

describe('StepsConfigParser hook construction', () => {
  let ctx: BuildStepGlobalContext;

  beforeEach(() => {
    ctx = createGlobalContextMock();
  });

  it('parses identically when hooks are undefined or empty (dormancy)', async () => {
    for (const hooks of [undefined, {}]) {
      const workflow = await parseWorkflowAsync({
        ctx: createGlobalContextMock(),
        steps: [{ uses: 'eas/checkout' }, { run: 'echo hi', id: 'user-step' }],
        hooks,
      });
      expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Checkout', 'user-step']);
      expect(workflow.hooksByAnchorStep.size).toBe(0);
    }
  });

  it('attaches before and after hook entries to a function anchor without splicing them into buildSteps', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }, { uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }],
        after_install_node_modules: [{ run: 'echo after', id: 'after-hook' }],
      },
    });
    // Hook steps never join buildSteps; the engine executes them around the anchor.
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
      'Checkout',
      'Install node modules',
    ]);
    const installStep = workflow.buildSteps[1];
    const anchorHooks = workflow.hooksByAnchorStep.get(installStep);
    expect(anchorHooks?.anchor).toBe('install_node_modules');
    expect(anchorHooks?.before.map(entry => entry.steps.map(step => step.displayName))).toEqual([
      ['before-hook'],
    ]);
    expect(anchorHooks?.after.map(entry => entry.steps.map(step => step.displayName))).toEqual([
      ['after-hook'],
    ]);
    expect(orderedDisplayNames(workflow)).toEqual([
      'Checkout',
      'before-hook',
      'Install node modules',
      'after-hook',
    ]);
  });

  it('generates step ids in the spliced order (before → anchor → after) for id parity', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before' }],
        after_install_node_modules: [{ run: 'echo after' }],
      },
    });
    const orderedIds = workflow.getExecutionOrderedSteps().map(step => step.id);
    // Generated ids are sequential (step-NNN); execution order must equal
    // generation order with no ids consumed and discarded in between,
    // exactly as splicing produced it.
    const numbers = orderedIds.map(id => Number(id.replace('step-', '')));
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  it('resolves a stamped shell step (merged maestro_cloud) to its anchor', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ run: 'echo maestro cloud', id: 'maestro_cloud', __hook_id: 'maestro_cloud' }],
      hooks: {
        before_maestro_cloud: [{ run: 'echo before', id: 'before-hook' }],
        after_maestro_cloud: [{ run: 'echo after', id: 'after-hook' }],
      },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['before-hook', 'maestro_cloud', 'after-hook']);
  });

  it('wraps every occurrence of an anchored function independently (per-occurrence entries)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }, { uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before' }],
        after_install_node_modules: [{ run: 'echo after' }],
      },
    });
    expect(orderedDisplayNames(workflow)).toEqual([
      'echo before',
      'Install node modules',
      'echo after',
      'echo before',
      'Install node modules',
      'echo after',
    ]);
    expect(workflow.hooksByAnchorStep.size).toBe(2);
    const [firstHooks, secondHooks] = [...workflow.hooksByAnchorStep.values()];
    expect(firstHooks.before[0].steps[0]).not.toBe(secondHooks.before[0].steps[0]);
  });

  it('never treats hook-constructed steps as anchors (no nesting, direct anchored function)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ uses: 'eas/install_node_modules', id: 'hook-install' }],
      },
    });
    expect(workflow.hooksByAnchorStep.size).toBe(1);
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before[0].steps[0].id).toBe('hook-install');
    // The hook step invoking the anchored function got no hooks of its own.
    expect(workflow.hooksByAnchorStep.get(anchorHooks.before[0].steps[0])).toBeUndefined();
  });

  it('ignores unknown hook keys without erroring (worker skew constraint)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_some_future_anchor: [{ run: 'echo never' }],
        not_a_hook_key: [{ run: 'echo never' }],
      },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['Install node modules']);
  });

  it('keeps unknown hook keys fully inert even when their steps reference unknown functions', async () => {
    // A newer server may send hooks for anchors (and functions) this worker
    // does not know yet — they must never fail the parse.
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_some_future_anchor: [{ uses: 'eas/some_future_function' }],
        also_not_a_hook_key: ['not even steps' as unknown as Step],
      },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['Install node modules']);
  });

  it('ignores hook keys whose anchor is not present in the steps', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }],
      hooks: { before_install_node_modules: [{ run: 'echo never' }] },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['Checkout']);
  });

  it('treats an explicit empty hook array as a deliberate no-op', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [] },
    });
    expect(workflow.hooksByAnchorStep.size).toBe(0);
  });

  it('validates hook step arrays like job steps (BuildConfigError, not a crash)', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        // Simulates a malformed payload arriving over the wire (no intake validation).
        hooks: { before_install_node_modules: [{ id: 'neither-run-nor-uses' } as unknown as Step] },
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/before_install_node_modules/);
  });

  it('rejects a non-array hook value with BuildConfigError instead of dropping it silently', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        // Simulates a malformed payload arriving over the wire.
        hooks: { before_install_node_modules: 'echo hi' as unknown as Step[] },
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/before_install_node_modules/);
  });

  it('rejects a hook function step naming an unknown function with BuildConfigError', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: 'eas/nonexistent_function' }] },
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/nonexistent_function/);
  });

  it('rejects a hook step using a local composite function with BuildConfigError, not an assertion crash', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup' }] },
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/not supported in hooks/);
  });
});

describe('constructHookEntriesAsync (public API)', () => {
  it('treats an empty hook step array as a valid no-op', async () => {
    const ctx = createGlobalContextMock();
    await expect(
      constructHookEntriesAsync(ctx, [], {
        externalFunctions: [createInstallNodeModulesFunction()],
      })
    ).resolves.toEqual([]);
  });

  it('rejects duplicate function ids instead of letting array order pick the implementation', async () => {
    const ctx = createGlobalContextMock();
    await expect(
      constructHookEntriesAsync(ctx, [{ uses: 'eas/install_node_modules' }], {
        externalFunctions: [createInstallNodeModulesFunction(), createInstallNodeModulesFunction()],
      })
    ).rejects.toThrow('already defined');
  });

  it('validateHookStepsAsync rejects duplicate ids across an ordered view (public API)', async () => {
    const ctx = createGlobalContextMock();
    const entries = await constructHookEntriesAsync(
      ctx,
      [
        { run: 'echo a', id: 'dup' },
        { run: 'echo b', id: 'dup' },
      ],
      {}
    );
    await expect(
      validateHookStepsAsync(
        ctx,
        entries.flatMap(entry => entry.steps)
      )
    ).rejects.toThrow('Hook steps are invalid.');
  });
});

describe('StepsConfigParser stamp semantics', () => {
  let ctx: BuildStepGlobalContext;

  beforeEach(() => {
    ctx = createGlobalContextMock();
  });

  it('a stamp matching the invoked function declaration anchors the step', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules', __hook_id: 'install_node_modules' }],
      hooks: { before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }] },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['before-hook', 'Install node modules']);
  });

  it('a stamp CONFLICTING with the function declaration wins over it', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      // install_node_modules function, stamped as the submit anchor.
      steps: [{ uses: 'eas/install_node_modules', __hook_id: 'submit' }],
      hooks: {
        before_submit: [{ run: 'echo before submit', id: 'submit-hook' }],
        before_install_node_modules: [{ run: 'echo never' }],
      },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['submit-hook', 'Install node modules']);
  });

  it('an UNREGISTERED stamp on a declaring function step is inert — no fallback to the declaration', async () => {
    // A newer server stamping a future anchor must render the step inert on
    // this worker, never silently rebind it to the function's older anchor.
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules', __hook_id: 'some_future_anchor' }],
      hooks: { before_install_node_modules: [{ run: 'echo never' }] },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['Install node modules']);
    expect(workflow.hooksByAnchorStep.size).toBe(0);
  });

  it('an unstamped step invoking a declaring function resolves via the declaration', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }] },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['before-hook', 'Install node modules']);
  });
});

describe('StepsConfigParser hooks with function groups', () => {
  let ctx: BuildStepGlobalContext;
  let checkoutFunction: BuildFunction;
  let installFunction: BuildFunction;

  beforeEach(() => {
    ctx = createGlobalContextMock();
    checkoutFunction = createCheckoutFunction();
    installFunction = createInstallNodeModulesFunction();
  });

  function createGroup(id = 'group'): BuildFunctionGroup {
    return new BuildFunctionGroup({
      namespace: 'test',
      id,
      createBuildStepsFromFunctionGroupCall: globalCtx => [
        checkoutFunction.createBuildStepFromFunctionCall(globalCtx),
        installFunction.createBuildStepFromFunctionCall(globalCtx),
      ],
    });
  }

  it('attaches hooks to anchored functions inside a group expansion (late construction)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'test/group' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }],
        after_install_node_modules: [{ run: 'echo after', id: 'after-hook' }],
      },
      externalFunctions: [checkoutFunction, installFunction],
      externalFunctionGroups: [createGroup()],
    });
    expect(orderedDisplayNames(workflow)).toEqual([
      'Checkout',
      'before-hook',
      'Install node modules',
      'after-hook',
    ]);
  });

  it('leaves group expansions without anchored functions untouched', async () => {
    const group = new BuildFunctionGroup({
      namespace: 'test',
      id: 'group',
      createBuildStepsFromFunctionGroupCall: globalCtx => [
        new BuildFunction({
          id: 'not_an_anchor',
          command: 'echo x',
        }).createBuildStepFromFunctionCall(globalCtx),
      ],
    });
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'test/group' }],
      hooks: { before_install_node_modules: [{ run: 'echo never' }] },
      externalFunctions: [],
      externalFunctionGroups: [group],
    });
    expect(workflow.buildSteps).toHaveLength(1);
    expect(workflow.hooksByAnchorStep.size).toBe(0);
  });

  it('parses a function group inside an after hook as ONE entry with the expansion inside', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { after_install_node_modules: [{ uses: 'test/group' }] },
      externalFunctions: [installFunction, checkoutFunction],
      externalFunctionGroups: [createGroup()],
    });
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.after).toHaveLength(1);
    expect(anchorHooks.after[0].steps.map(step => step.displayName)).toEqual([
      'Checkout',
      'Install node modules',
    ]);
  });

  it('carries the authored if: of a group hook step on the entry (expansion drops step-level if:)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: 'test/group', if: '${{ failure() }}' }] },
      externalFunctions: [installFunction, checkoutFunction],
      externalFunctionGroups: [createGroup()],
    });
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before[0].ifCondition).toBe('${{ failure() }}');
  });

  it('does not attach hooks inside a group expansion that is itself a hook step (no nesting)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: 'test/group' }] },
      externalFunctions: [installFunction, checkoutFunction],
      externalFunctionGroups: [createGroup()],
    });
    // Exactly one anchor: the job's own install step. The install step inside
    // the hook's group expansion got nothing.
    expect(workflow.hooksByAnchorStep.size).toBe(1);
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    for (const hookStep of anchorHooks.before.flatMap(entry => entry.steps)) {
      expect(workflow.hooksByAnchorStep.get(hookStep)).toBeUndefined();
    }
  });

  it('a REGISTERED stamp on a group call is inert like any other stamp on a group call', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'test/group', __hook_id: 'submit' }],
      hooks: { before_submit: [{ run: 'echo never' }] },
      externalFunctions: [installFunction, checkoutFunction],
      externalFunctionGroups: [createGroup()],
    });
    // The group expands normally; the stamp never matches an anchor, so the
    // submit hook stays unmatched (ignored, not run).
    expect(workflow.buildSteps).toHaveLength(2);
    expect(workflow.hooksByAnchorStep.size).toBe(0);
  });

  it('treats an UNREGISTERED-stamped group call as an inert ordinary step (skew outranks the group fence)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'test/group', __hook_id: 'some_future_anchor' }],
      hooks: { before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }] },
      externalFunctions: [installFunction, checkoutFunction],
      externalFunctionGroups: [createGroup()],
    });
    // The group expands normally; its inner anchored functions still anchor.
    expect(workflow.buildSteps).toHaveLength(2);
    expect(workflow.hooksByAnchorStep.size).toBe(1);
  });
});

describe('StepsConfigParser hooks with composite functions', () => {
  let ctx: BuildStepGlobalContext;

  beforeEach(() => {
    ctx = createGlobalContextMock();
  });

  it('never treats an anchored function inside a composite function as a hook trigger', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: './.eas/functions/setup', id: 'setup' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo never' }],
        after_install_node_modules: [{ run: 'echo never' }],
      },
      compositeFunctionCatalog: makeCatalog({
        './.eas/functions/setup': {
          runs: { steps: [{ uses: 'eas/install_node_modules' }] },
        },
      }),
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Install node modules']);
    expect(workflow.hooksByAnchorStep.size).toBe(0);
    // Structural invariant, not just parse-time behavior: the expanded step
    // carries NO anchor mark, so a future runtime discovery mechanism (the
    // native hook runner) cannot resolve it as an anchor occurrence either.
    expect(workflow.buildSteps[0].__hookId).toBeUndefined();
  });

  it('anchors only the job-level occurrence when the same function is also called inside a composite function', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [
        { uses: './.eas/functions/setup', id: 'setup' },
        { uses: 'eas/install_node_modules' },
      ],
      hooks: {
        before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }],
        after_install_node_modules: [{ run: 'echo after', id: 'after-hook' }],
      },
      compositeFunctionCatalog: makeCatalog({
        './.eas/functions/setup': {
          runs: { steps: [{ uses: 'eas/install_node_modules' }] },
        },
      }),
    });
    expect(workflow.hooksByAnchorStep.size).toBe(1);
    expect(orderedDisplayNames(workflow)).toEqual([
      'Install node modules',
      'before-hook',
      'Install node modules',
      'after-hook',
    ]);
  });
});

describe('StepsConfigParser hook validation view', () => {
  let ctx: BuildStepGlobalContext;

  beforeEach(() => {
    ctx = createGlobalContextMock();
  });

  it('fails parseAsync when a hook step id collides with a job step id', async () => {
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }, { run: 'echo hi', id: 'my-step' }],
        hooks: { before_install_node_modules: [{ run: 'echo hook', id: 'my-step' }] },
      });
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
  });

  it('fails parseAsync when two hooks of different keys collide on step id', async () => {
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [{ run: 'echo a', id: 'dup' }],
          after_install_node_modules: [{ run: 'echo b', id: 'dup' }],
        },
      });
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
  });

  it('validates output references through the ordered view: a step before the anchor cannot reference an after-hook output', async () => {
    const consumer = new BuildFunction({
      namespace: 'test',
      id: 'consumer',
      command: 'echo consume',
      inputProviders: [
        BuildStepInput.createProvider({
          id: 'value',
          required: true,
          defaultValue: '${ steps.late-hook.value }',
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
      ],
    });
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'test/consumer' }, { uses: 'eas/install_node_modules' }],
        hooks: {
          after_install_node_modules: [
            { run: 'echo hook', id: 'late-hook', outputs: [{ name: 'value' }] },
          ],
        },
        externalFunctions: [createInstallNodeModulesFunction(), consumer],
      });
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    expect((error as BuildWorkflowError).errors[0].message).toMatch(/future step "late-hook"/);

    // The mirror case is valid: a step AFTER the anchor sees the after-hook's
    // output, because the ordered view places the hook before it.
    await expect(
      parseWorkflowAsync({
        ctx: createGlobalContextMock(),
        steps: [{ uses: 'eas/install_node_modules' }, { uses: 'test/consumer' }],
        hooks: {
          after_install_node_modules: [
            { run: 'echo hook', id: 'late-hook', outputs: [{ name: 'value' }] },
          ],
        },
        externalFunctions: [createInstallNodeModulesFunction(), consumer],
      })
    ).resolves.toBeInstanceOf(BuildWorkflow);
  });

  it('validates runtime-platform allowance for hook steps through the same aggregate view', async () => {
    const darwinOnly = new BuildFunction({
      namespace: 'test',
      id: 'darwin_only',
      command: 'echo darwin',
      supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    });
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await parseWorkflowAsync({
        // The mock context runs on LINUX.
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: 'test/darwin_only' }] },
        externalFunctions: [createInstallNodeModulesFunction(), darwinOnly],
      });
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    expect((error as BuildWorkflowError).errors[0].message).toMatch(/not allowed on platform/);
  });
});
