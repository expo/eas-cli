import {
  CompositeFunctionConfig,
  CompositeFunctionConfigZ,
  Hooks,
  LocalFunctionCatalog,
  Step,
} from '@expo/eas-build-job';

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
  localFunctionCatalog,
  loadLocalFunction,
}: {
  ctx: BuildStepGlobalContext;
  steps: Step[];
  hooks: Hooks | undefined;
  externalFunctions?: BuildFunction[];
  externalFunctionGroups?: BuildFunctionGroup[];
  localFunctionCatalog?: LocalFunctionCatalog;
  loadLocalFunction?: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
}): Promise<BuildWorkflow> {
  const parser = new StepsConfigParser(ctx, {
    steps,
    hooks,
    externalFunctions: externalFunctions ?? [
      createInstallNodeModulesFunction(),
      createCheckoutFunction(),
    ],
    externalFunctionGroups,
    localFunctionCatalog,
    loadLocalFunction,
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
    expect(error.message).toMatch(/hooks\.before_install_node_modules/);
  });

  it('ignores a registered hook key whose anchor is absent even when its steps use unknown functions', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }],
      hooks: { before_install_node_modules: [{ uses: 'eas/some_newer_function' }] },
    });
    expect(orderedDisplayNames(workflow)).toEqual(['Checkout']);
    expect(workflow.hooksByAnchorStep.size).toBe(0);
    expect(ctx.baseLogger.warn).toHaveBeenCalledWith(
      'Ignoring "hooks.before_install_node_modules": this build does not run the "install_node_modules" step.'
    );
  });

  it('rejects a hook step using a composite function missing from the catalog with BuildConfigError', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup' }] },
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/"\.\/\.eas\/functions\/setup" does not exist/);
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
      localFunctionCatalog: makeCatalog({
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
      localFunctionCatalog: makeCatalog({
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

  it('rejects a REGISTERED stamp on a composite call even when it expands into a single step', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: './.eas/functions/setup', id: 'setup', __hook_id: 'install_node_modules' }],
        hooks: { before_install_node_modules: [{ run: 'echo never' }] },
        localFunctionCatalog: makeCatalog({
          './.eas/functions/setup': {
            runs: { steps: [{ run: 'echo setup' }] },
          },
        }),
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toBe(
      'Hook anchors are not supported on steps that call a local function.'
    );
  });

  it('rejects a REGISTERED stamp on a composite call that expands into multiple steps', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: './.eas/functions/setup', id: 'setup', __hook_id: 'install_node_modules' }],
        hooks: { before_install_node_modules: [{ run: 'echo never' }] },
        localFunctionCatalog: makeCatalog({
          './.eas/functions/setup': {
            runs: { steps: [{ run: 'echo one' }, { run: 'echo two' }] },
          },
        }),
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toBe(
      'Hook anchors are not supported on steps that call a local function.'
    );
  });

  it('treats an UNREGISTERED-stamped composite call as an inert ordinary step (skew tolerance)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: './.eas/functions/setup', id: 'setup', __hook_id: 'some_future_anchor' }],
      hooks: { before_install_node_modules: [{ run: 'echo never' }] },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/setup': {
          runs: { steps: [{ uses: 'eas/install_node_modules' }] },
        },
      }),
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Install node modules']);
    expect(workflow.hooksByAnchorStep.size).toBe(0);
  });

  it('parses a composite hook step into a single entry with namespaced children and the outputs step last', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }],
      },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/setup': {
          outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
          runs: {
            steps: [{ id: 'read', run: 'set-output version "1.0.0"' }, { run: 'echo hi' }],
          },
        },
      }),
    });
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before).toHaveLength(1);
    expect(anchorHooks.before[0].steps.map(step => step.id)).toEqual([
      'setup__read',
      'setup__composite_function_step_1',
      'setup',
    ]);
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Install node modules']);
  });

  it('parses a single-step function hook step into one entry with one step', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [
          { uses: './.eas/functions/say-hi', id: 'greet', if: '${{ always() }}' },
        ],
      },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/say-hi': { name: 'Say hi', command: 'echo hi' },
      }),
    });
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before).toHaveLength(1);
    const [hookStep] = anchorHooks.before[0].steps;
    expect(anchorHooks.before[0].steps).toHaveLength(1);
    expect(hookStep.id).toBe('greet');
    expect(hookStep.displayName).toBe('Say hi');
    expect(hookStep.command).toBe('echo hi');
    expect(hookStep.ifCondition).toBe('${{ always() }}');
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Install node modules']);
  });

  it('does not copy the if condition of a composite hook step onto the entry', async () => {
    // The authored if: is applied inside the expansion scope, not on the entry.
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [
          { uses: './.eas/functions/setup', id: 'setup', if: '${{ failure() }}' },
        ],
      },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/setup': {
          runs: { steps: [{ run: 'echo hi' }] },
        },
      }),
    });
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before[0].ifCondition).toBeUndefined();
  });

  it('rejects working_directory on a composite hook step', async () => {
    // The call expands away during parsing, so there is no single step to apply it to.
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: './.eas/functions/setup', id: 'setup', working_directory: 'app' },
          ],
        },
        localFunctionCatalog: makeCatalog({
          './.eas/functions/setup': {
            runs: { steps: [{ run: 'echo hi' }] },
          },
        }),
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/"working_directory" is not supported/);
  });

  it('reports the hook key on composite expansion errors', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [{ uses: './.eas/functions/notify', id: 'notify' }],
        },
        localFunctionCatalog: makeCatalog({
          './.eas/functions/notify': {
            inputs: [{ name: 'message', type: 'string', required: true }],
            runs: { steps: [{ run: 'echo hi' }] },
          },
        }),
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(
      /^Invalid steps in "hooks\.before_install_node_modules": Input parameter "message"/
    );
  });

  it('flattens nested composite calls into a single hook entry', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ uses: './.eas/functions/outer', id: 'top' }],
      },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/outer': {
          runs: {
            steps: [{ uses: './.eas/functions/inner', id: 'mid' }, { run: 'echo done' }],
          },
        },
        './.eas/functions/inner': {
          runs: { steps: [{ run: 'echo inner' }] },
        },
      }),
    });
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before).toHaveLength(1);
    // No declared outputs, so no outputs nodes appear in the expansion.
    expect(anchorHooks.before[0].steps.map(step => step.id)).toEqual([
      'top__mid__composite_function_step_1',
      'top__composite_function_step_1',
    ]);
  });

  it('orders composite hook expansions as before hook, anchor, then after hook', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }],
        after_install_node_modules: [{ uses: './.eas/functions/teardown', id: 'teardown' }],
      },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/setup': {
          runs: { steps: [{ id: 'prepare', run: 'echo prepare' }] },
        },
        './.eas/functions/teardown': {
          runs: { steps: [{ id: 'clean', run: 'echo clean' }] },
        },
      }),
    });
    expect(workflow.getExecutionOrderedSteps().map(step => step.id)).toEqual([
      'setup__prepare',
      expect.stringMatching(/^step-\d{3,}$/),
      'teardown__clean',
    ]);
  });

  it('fails parseAsync when a composite hook call id collides with a job step id', async () => {
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }, { run: 'echo job', id: 'setup' }],
        hooks: {
          before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }],
        },
        localFunctionCatalog: makeCatalog({
          './.eas/functions/setup': {
            // Outputs node reuses the call id, forcing the collision with the job step.
            outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
            runs: { steps: [{ id: 'read', run: 'set-output version "1.0.0"' }] },
          },
        }),
      });
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
  });
});

describe('StepsConfigParser lazy hook composite loading', () => {
  let ctx: BuildStepGlobalContext;

  beforeEach(() => {
    ctx = createGlobalContextMock();
  });

  function createLoader(entries: Record<string, unknown>): {
    loadLocalFunction: (compositeFunctionPath: string) => Promise<CompositeFunctionConfig>;
    loadedPaths: string[];
  } {
    const loadedPaths: string[] = [];
    return {
      loadedPaths,
      loadLocalFunction: async compositeFunctionPath => {
        loadedPaths.push(compositeFunctionPath);
        const raw = entries[compositeFunctionPath];
        if (raw === undefined) {
          throw new Error(`no such composite function: ${compositeFunctionPath}`);
        }
        return CompositeFunctionConfigZ.parse(raw);
      },
    };
  }

  function rejectingLoader(): (compositeFunctionPath: string) => Promise<CompositeFunctionConfig> {
    return async compositeFunctionPath => {
      throw new Error(`must not be called, got: ${compositeFunctionPath}`);
    };
  }

  it('loads a hook composite through the loader (normalized path) when the anchor is present', async () => {
    const { loadLocalFunction, loadedPaths } = createLoader({
      './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
    });
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        // Trailing slash must normalize before the loader is called.
        before_install_node_modules: [{ uses: './.eas/functions/setup/', id: 'setup' }],
      },
      loadLocalFunction,
    });
    expect(loadedPaths).toEqual(['./.eas/functions/setup']);
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before).toHaveLength(1);
    expect(anchorHooks.before[0].steps.map(step => step.id)).toEqual([
      'setup__composite_function_step_1',
    ]);
  });

  it('never calls the loader and parses successfully when the hook anchor is absent', async () => {
    // www merges defaults.hooks into every job; absent anchors must not fail on
    // composites that only resolve under another job's project root.
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }],
      hooks: {
        before_install_node_modules: [{ uses: './.eas/functions/only-elsewhere' }],
      },
      loadLocalFunction: rejectingLoader(),
    });
    expect(orderedDisplayNames(workflow)).toEqual(['Checkout']);
  });

  it('warns for a registered hook key whose anchor never appeared', async () => {
    await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }],
      hooks: { before_install_node_modules: [{ run: 'echo never' }] },
    });
    expect(ctx.baseLogger.warn).toHaveBeenCalledWith(
      'Ignoring "hooks.before_install_node_modules": this build does not run the "install_node_modules" step.'
    );
  });

  it('warns for an unknown hook key', async () => {
    await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }],
      hooks: { before_install_node_module: [{ run: 'echo typo' }] },
    });
    expect(ctx.baseLogger.warn).toHaveBeenCalledWith(
      'Ignoring unknown hook key "before_install_node_module".'
    );
  });

  it('wraps a loader failure in a BuildConfigError naming the before-side hook key', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { before_install_node_modules: [{ uses: './.eas/functions/missing' }] },
        loadLocalFunction: createLoader({}).loadLocalFunction,
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/hooks\.before_install_node_modules/);
    expect(error.message).toMatch(/no such composite function: \.\/\.eas\/functions\/missing/);
  });

  it('names the after-side hook key in the wrapped loader failure', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: './.eas/functions/missing' }] },
        loadLocalFunction: createLoader({}).loadLocalFunction,
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/hooks\.after_install_node_modules/);
  });

  it('names the hook key when a composite hook call sets working_directory', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: {
          before_install_node_modules: [
            { uses: './.eas/functions/setup', id: 'setup', working_directory: 'app' },
          ],
        },
        loadLocalFunction: createLoader({
          './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
        }).loadLocalFunction,
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/hooks\.before_install_node_modules/);
    expect(error.message).toMatch(/"working_directory" is not supported/);
    expect(error.message).not.toMatch(/Failed to load/);
  });

  it('calls the loader once per composite across repeated occurrences of the same anchor', async () => {
    const { loadLocalFunction, loadedPaths } = createLoader({
      './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
    });
    await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }, { uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup' }] },
      loadLocalFunction,
    });
    expect(loadedPaths).toEqual(['./.eas/functions/setup']);
  });

  it('never calls the loader for a composite already present in the prebuilt catalog', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup' }] },
      localFunctionCatalog: makeCatalog({
        './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
      }),
      loadLocalFunction: rejectingLoader(),
    });
    expect(workflow.hooksByAnchorStep.size).toBe(1);
  });

  it('loads composites transitively referenced by a hook composite', async () => {
    const { loadLocalFunction, loadedPaths } = createLoader({
      './.eas/functions/outer': {
        runs: { steps: [{ uses: './.eas/functions/inner', id: 'mid' }] },
      },
      './.eas/functions/inner': { runs: { steps: [{ run: 'echo inner' }] } },
    });
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: './.eas/functions/outer', id: 'top' }] },
      loadLocalFunction,
    });
    expect(loadedPaths.sort()).toEqual(['./.eas/functions/inner', './.eas/functions/outer']);
    const anchorHooks = [...workflow.hooksByAnchorStep.values()][0];
    expect(anchorHooks.before[0].steps.map(step => step.id)).toEqual([
      'top__mid__composite_function_step_1',
    ]);
  });

  it('loads hook composites for an anchor discovered inside a function-group expansion', async () => {
    const checkoutFunction = createCheckoutFunction();
    const installFunction = createInstallNodeModulesFunction();
    const group = new BuildFunctionGroup({
      namespace: 'test',
      id: 'group',
      createBuildStepsFromFunctionGroupCall: globalCtx => [
        checkoutFunction.createBuildStepFromFunctionCall(globalCtx),
        installFunction.createBuildStepFromFunctionCall(globalCtx),
      ],
    });
    const { loadLocalFunction, loadedPaths } = createLoader({
      './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
    });
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'test/group' }],
      hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup', id: 'setup' }] },
      externalFunctions: [checkoutFunction, installFunction],
      externalFunctionGroups: [group],
      loadLocalFunction,
    });
    expect(loadedPaths).toEqual(['./.eas/functions/setup']);
    expect(workflow.hooksByAnchorStep.size).toBe(1);
  });

  it('does not mutate the caller-owned catalog when loading lazily', async () => {
    const callerCatalog = makeCatalog({});
    await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: './.eas/functions/setup' }] },
      localFunctionCatalog: callerCatalog,
      loadLocalFunction: createLoader({
        './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
      }).loadLocalFunction,
    });
    expect(Object.keys(callerCatalog)).toEqual([]);
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

describe('deprecated composite function option keys', () => {
  let ctx: BuildStepGlobalContext;

  beforeEach(() => {
    ctx = createGlobalContextMock();
  });

  it('StepsConfigParser accepts compositeFunctionCatalog and loadCompositeFunction', async () => {
    const parser = new StepsConfigParser(ctx, {
      steps: [
        { uses: './.eas/functions/setup', id: 'setup' },
        { uses: 'eas/install_node_modules' },
      ],
      hooks: { before_install_node_modules: [{ uses: './.eas/functions/hook-fn' }] },
      externalFunctions: [createInstallNodeModulesFunction()],
      compositeFunctionCatalog: makeCatalog({
        './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
      }),
      loadCompositeFunction: async () =>
        CompositeFunctionConfigZ.parse({ runs: { steps: [{ run: 'echo hook' }] } }),
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps).toHaveLength(2);
    expect(workflow.hooksByAnchorStep.size).toBe(1);
  });

  it('constructHookEntriesAsync accepts compositeFunctionCatalog', async () => {
    const entries = await constructHookEntriesAsync(ctx, [{ uses: './.eas/functions/setup' }], {
      compositeFunctionCatalog: makeCatalog({
        './.eas/functions/setup': { runs: { steps: [{ run: 'echo setup' }] } },
      }),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].steps).toHaveLength(1);
  });
});
