import { Hooks, Step } from '@expo/eas-build-job';

import { createGlobalContextMock } from './utils/context';
import { getErrorAsync } from './utils/error';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepGlobalContext } from '../BuildStepContext';
import { BuildWorkflow } from '../BuildWorkflow';
import { StepsConfigParser } from '../StepsConfigParser';
import { BuildConfigError, BuildWorkflowError } from '../errors';

function createInstallNodeModulesFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'install_node_modules',
    name: 'Install node modules',
    command: 'npm install',
  });
}

function createCheckoutFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'checkout',
    name: 'Checkout',
    command: 'echo checkout',
  });
}

async function parseWorkflowAsync({
  ctx,
  steps,
  hooks,
  externalFunctions,
  externalFunctionGroups,
}: {
  ctx: BuildStepGlobalContext;
  steps: Step[];
  hooks: Hooks | undefined;
  externalFunctions?: BuildFunction[];
  externalFunctionGroups?: BuildFunctionGroup[];
}): Promise<BuildWorkflow> {
  const parser = new StepsConfigParser(ctx, {
    steps,
    hooks,
    externalFunctions: externalFunctions ?? [
      createInstallNodeModulesFunction(),
      createCheckoutFunction(),
    ],
    externalFunctionGroups,
  });
  return await parser.parseAsync();
}

describe('StepsConfigParser hooks insertion', () => {
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
    }
  });

  it('wraps a function anchor with before and after hooks', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }, { uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }],
        after_install_node_modules: [{ run: 'echo after', id: 'after-hook' }],
      },
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
      'Checkout',
      'before-hook',
      'Install node modules',
      'after-hook',
    ]);
    const installStep = workflow.buildSteps[2];
    const afterHookStep = workflow.buildSteps[3];
    expect(afterHookStep.runAfterStep).toBe(installStep);
    expect(workflow.buildSteps[1].runAfterStep).toBeUndefined();
  });

  it('desugars __hook_id into a wrap of a single shell step', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ run: 'echo submit', id: 'submit-step', __hook_id: 'submit' }],
      hooks: {
        before_submit: [{ run: 'echo before', id: 'before-hook' }],
        after_submit: [{ run: 'echo after', id: 'after-hook' }],
      },
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
      'before-hook',
      'submit-step',
      'after-hook',
    ]);
    expect(workflow.buildSteps[2].runAfterStep).toBe(workflow.buildSteps[1]);
  });

  it('handles the split stamp pair with the gate on the before-side step', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [
        { run: 'echo upload', id: 'upload', __hook_before_id: 'maestro_cloud' },
        { run: 'echo results', id: 'results', __hook_after_id: 'maestro_cloud' },
      ],
      hooks: {
        before_maestro_cloud: [{ run: 'echo before', id: 'before-hook' }],
        after_maestro_cloud: [{ run: 'echo after', id: 'after-hook' }],
      },
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
      'before-hook',
      'upload',
      'results',
      'after-hook',
    ]);
    // The gate is the BEFORE-side step (upload), so after_maestro_cloud still
    // fires when the results step self-skips.
    const uploadStep = workflow.buildSteps[1];
    expect(workflow.buildSteps[3].runAfterStep).toBe(uploadStep);
  });

  it('rejects __hook_id combined with the split pair on the same step', async () => {
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ run: 'echo x', __hook_id: 'submit', __hook_before_id: 'maestro_cloud' }],
        hooks: { before_submit: [{ run: 'echo before' }] },
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/__hook_id/);
  });

  it('wraps every occurrence of an anchored function independently', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }, { uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before' }],
        after_install_node_modules: [{ run: 'echo after' }],
      },
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
      'echo before',
      'Install node modules',
      'echo after',
      'echo before',
      'Install node modules',
      'echo after',
    ]);
    expect(workflow.buildSteps[2].runAfterStep).toBe(workflow.buildSteps[1]);
    expect(workflow.buildSteps[5].runAfterStep).toBe(workflow.buildSteps[4]);
  });

  it('never treats hook-inserted steps as anchors (no nesting)', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        before_install_node_modules: [{ uses: 'eas/install_node_modules', id: 'hook-install' }],
      },
    });
    // The hook step invoking the anchored function is just a step: exactly one
    // insertion, no recursive wrapping. (displayName is the function name for
    // both, so assert on ids.)
    expect(workflow.buildSteps).toHaveLength(2);
    expect(workflow.buildSteps[0].id).toBe('hook-install');
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
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Install node modules']);
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
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Install node modules']);
  });

  it('ignores hook keys whose anchor is not present in the steps', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }],
      hooks: { before_install_node_modules: [{ run: 'echo never' }] },
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual(['Checkout']);
  });

  it('supports after-only usage gated on the anchor step itself', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/checkout' }, { run: 'echo hi' }],
      hooks: { after_checkout: [{ run: 'echo after', id: 'after-hook' }] },
    });
    expect(workflow.buildSteps.map(step => step.displayName)).toEqual([
      'Checkout',
      'after-hook',
      'echo hi',
    ]);
    expect(workflow.buildSteps[1].runAfterStep).toBe(workflow.buildSteps[0]);
  });

  it('hook steps are ordinary steps: function hook steps parse and receive the gate', async () => {
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: {
        after_install_node_modules: [
          { uses: 'eas/checkout', id: 'hook-checkout', if: '${{ always() }}' },
        ],
      },
    });
    expect(workflow.buildSteps).toHaveLength(2);
    expect(workflow.buildSteps[1].id).toBe('hook-checkout');
    expect(workflow.buildSteps[1].runAfterStep).toBe(workflow.buildSteps[0]);
    expect(workflow.buildSteps[1].ifCondition).toBe('${{ always() }}');
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
});

describe('StepsConfigParser hooks insertion inside function-group expansions', () => {
  let ctx: BuildStepGlobalContext;
  let checkoutFunction: BuildFunction;
  let installFunction: BuildFunction;

  beforeEach(() => {
    ctx = createGlobalContextMock();
    checkoutFunction = createCheckoutFunction();
    installFunction = createInstallNodeModulesFunction();
  });

  it('inserts hooks around anchored functions inside a group expansion', async () => {
    const group = new BuildFunctionGroup({
      namespace: 'test',
      id: 'group',
      createBuildStepsFromFunctionGroupCall: globalCtx => [
        checkoutFunction.createBuildStepFromFunctionCall(globalCtx),
        installFunction.createBuildStepFromFunctionCall(globalCtx),
      ],
    });
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'test/group' }],
      hooks: {
        before_install_node_modules: [{ run: 'echo before', id: 'before-hook' }],
        after_install_node_modules: [{ run: 'echo after', id: 'after-hook' }],
      },
      externalFunctions: [checkoutFunction, installFunction],
      externalFunctionGroups: [group],
    });
    expect(workflow.buildSteps.map(step => step.sourceFunction?.getFullId() ?? step.id)).toEqual([
      'eas/checkout',
      'before-hook',
      'eas/install_node_modules',
      'after-hook',
    ]);
    const installStep = workflow.buildSteps[2];
    expect(workflow.buildSteps[3].runAfterStep).toBe(installStep);
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
  });

  it('rejects a function group inside an after hook (its steps cannot be gated on the anchor)', async () => {
    const group = new BuildFunctionGroup({
      namespace: 'test',
      id: 'group',
      createBuildStepsFromFunctionGroupCall: globalCtx => [
        checkoutFunction.createBuildStepFromFunctionCall(globalCtx),
      ],
    });
    const error = await getErrorAsync<BuildConfigError>(async () => {
      await parseWorkflowAsync({
        ctx,
        steps: [{ uses: 'eas/install_node_modules' }],
        hooks: { after_install_node_modules: [{ uses: 'test/group' }] },
        externalFunctions: [installFunction, checkoutFunction],
        externalFunctionGroups: [group],
      });
    });
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/after hook/);
  });

  it('does not insert hooks into a group expansion that is itself a hook step (no nesting)', async () => {
    const group = new BuildFunctionGroup({
      namespace: 'test',
      id: 'group',
      createBuildStepsFromFunctionGroupCall: globalCtx => [
        installFunction.createBuildStepFromFunctionCall(globalCtx),
      ],
    });
    const workflow = await parseWorkflowAsync({
      ctx,
      steps: [{ uses: 'eas/install_node_modules' }],
      hooks: { before_install_node_modules: [{ uses: 'test/group' }] },
      externalFunctions: [installFunction],
      externalFunctionGroups: [group],
    });
    // hook group expansion (1 install step, NOT wrapped) + anchor install step.
    expect(workflow.buildSteps).toHaveLength(2);
  });
});
