import {
  HookAnchorId,
  ShellStep,
  Step,
  isStepFunctionStep,
  validateSteps,
} from '@expo/eas-build-job';
import assert from 'node:assert';

import { BuildFunction, BuildFunctionById, createBuildFunctionByIdMapping } from './BuildFunction';
import {
  BuildFunctionGroup,
  BuildFunctionGroupById,
  createBuildFunctionGroupByIdMapping,
} from './BuildFunctionGroup';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepOutput } from './BuildStepOutput';
import { collectAggregateStepErrors } from './BuildWorkflowValidator';
import { BuildConfigError, BuildWorkflowError } from './errors';
import { isActionPath } from './utils/localActions';

/**
 * One entry per AUTHORED hook step — the unit the user wrote. The wrapper
 * earns its place twice. (1) A function-group call vanishes at expansion, so
 * the entry is the authored `if:`'s only home, evaluated once for the whole
 * group; `run:` and single-function entries keep the `if:` on the step itself
 * — the condition never exists in two places. Entry conditions see the global
 * context only; a group call's `with:` inputs are not visible to them.
 * (2) An entry whose explicit `if:` passed behaves like a single step whose
 * `if:` passed: its no-`if:` steps run past earlier entries' failures, while
 * within-entry failures still skip later siblings.
 */
export interface HookEntry {
  steps: BuildStep[];
  ifCondition?: string;
}

/**
 * The hook entries attached to one anchor step occurrence. Carries the anchor
 * id because a stamped anchor is not reverse-derivable from a `BuildStep`.
 */
export interface AnchorHooks {
  anchor: HookAnchorId;
  before: HookEntry[];
  after: HookEntry[];
}

/**
 * Constructs hook entries from authored hook steps: ONE authored step → ONE
 * entry, anchor discovery disabled (a hook step invoking an anchored function
 * or a function group never becomes an anchor itself — no nesting). Validates
 * step shapes and function existence; the aggregate (cross-key) validation is
 * `validateHookStepsAsync`.
 *
 * Promise-returning by contract (like `validateHookStepsAsync`) even though
 * the body is synchronous: this API is pre-published for the native hook
 * runner (phase 3, not yet landed), and widening sync → async later would
 * break its callers.
 */
export async function constructHookEntriesAsync(
  ctx: BuildStepGlobalContext,
  steps: Step[],
  {
    externalFunctions,
    externalFunctionGroups,
  }: {
    externalFunctions?: BuildFunction[];
    externalFunctionGroups?: BuildFunctionGroup[];
  }
): Promise<HookEntry[]> {
  // An empty array is a valid no-op (e.g. opting out of a default hook);
  // validateSteps requires at least one step, so short-circuit before it —
  // but ONLY for a real array (malformed wire input must still reach
  // validateSteps and be rejected, not silently disable the hook).
  if (Array.isArray(steps) && steps.length === 0) {
    return [];
  }
  const validatedSteps = validateSteps(steps);
  const buildFunctionById = createBuildFunctionByIdMapping(externalFunctions ?? []);
  const buildFunctionGroupById = createBuildFunctionGroupByIdMapping(externalFunctionGroups ?? []);
  validateAllStepFunctionsExist(validatedSteps, {
    externalFunctionIds: Object.keys(buildFunctionById),
    externalFunctionGroupIds: Object.keys(buildFunctionGroupById),
  });
  return constructHookEntriesFromValidatedSteps(ctx, validatedSteps, {
    buildFunctionById,
    buildFunctionGroupById,
  });
}

/**
 * Aggregate validation over an execution-ordered view of steps (unique ids,
 * output references, runtime-platform allowance). The parser runs it over
 * `job steps + hooks` (through `BuildWorkflowValidator`).
 */
export async function validateHookStepsAsync(
  ctx: BuildStepGlobalContext,
  orderedView: readonly BuildStep[]
): Promise<void> {
  const errors = collectAggregateStepErrors(orderedView, {
    runtimePlatform: ctx.runtimePlatform,
  });
  if (errors.length !== 0) {
    throw new BuildWorkflowError('Hook steps are invalid.', errors);
  }
}

/** Package-internal: the parser path — steps already validated, function maps already built. */
export function constructHookEntriesFromValidatedSteps(
  ctx: BuildStepGlobalContext,
  validatedSteps: Step[],
  {
    buildFunctionById,
    buildFunctionGroupById,
  }: {
    buildFunctionById: BuildFunctionById;
    buildFunctionGroupById: BuildFunctionGroupById;
  }
): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const step of validatedSteps) {
    if (!isStepFunctionStep(step)) {
      entries.push({
        steps: [createBuildStepFromShellStep(ctx, step)],
      });
      continue;
    }
    const maybeFunctionGroup = buildFunctionGroupById[step.uses];
    if (maybeFunctionGroup !== undefined) {
      entries.push({
        steps: maybeFunctionGroup.createBuildStepsFromFunctionGroupCall(ctx, {
          callInputs: step.with,
        }),
        ...(step.if ? { ifCondition: step.if } : null),
      });
      continue;
    }
    const buildFunction = buildFunctionById[step.uses];
    assert(buildFunction, 'function ID must be ID of function or function group');
    entries.push({
      steps: [
        buildFunction.createBuildStepFromFunctionCall(ctx, {
          id: step.id,
          name: step.name,
          callInputs: step.with,
          workingDirectory: step.working_directory,
          shell: step.shell,
          env: step.env,
          ifCondition: step.if,
        }),
      ],
    });
  }
  return entries;
}

/** Package-internal: shared shell-step construction (job steps and hook steps). */
export function createBuildStepFromShellStep(
  ctx: BuildStepGlobalContext,
  step: ShellStep
): BuildStep {
  const id = BuildStep.getNewId(step.id);
  const displayName =
    step.name ??
    step.id ??
    step.run
      .split('\n')
      .find(line => line.trim())
      ?.trim() ??
    step.run;
  const outputs = step.outputs?.map(
    entry =>
      new BuildStepOutput(ctx, {
        id: entry.name,
        stepDisplayName: displayName,
        required: entry.required ?? true,
      })
  );
  return new BuildStep(ctx, {
    id,
    displayName,
    outputs,
    workingDirectory: step.working_directory,
    shell: step.shell,
    command: step.run,
    env: step.env,
    ifCondition: step.if,
    __metricsId: step.__metrics_id,
  });
}

/** Package-internal. */
export function validateAllStepFunctionsExist(
  steps: Step[],
  {
    externalFunctionIds,
    externalFunctionGroupIds,
  }: {
    externalFunctionIds: string[];
    externalFunctionGroupIds: string[];
  }
): void {
  const calledFunctionsOrFunctionGroupsSet = new Set<string>();
  for (const step of steps) {
    if (step.uses && !isActionPath(step.uses)) {
      calledFunctionsOrFunctionGroupsSet.add(step.uses);
    }
  }
  const externalFunctionIdsSet = new Set(externalFunctionIds);
  const externalFunctionGroupsIdsSet = new Set(externalFunctionGroupIds);
  const nonExistentFunctionsOrFunctionGroups = Array.from(
    calledFunctionsOrFunctionGroupsSet
  ).filter(
    calledFunctionOrFunctionGroup =>
      !externalFunctionIdsSet.has(calledFunctionOrFunctionGroup) &&
      !externalFunctionGroupsIdsSet.has(calledFunctionOrFunctionGroup)
  );
  if (nonExistentFunctionsOrFunctionGroups.length > 0) {
    throw new BuildConfigError(
      `Calling non-existent functions: ${nonExistentFunctionsOrFunctionGroups
        .map(f => `"${f}"`)
        .join(', ')}.`
    );
  }
}
