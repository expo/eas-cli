import {
  HookAnchorId,
  ShellStep,
  Step,
  isStepFunctionStep,
  validateSteps,
} from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
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
import { StepMetricResult } from './StepMetrics';
import { BuildConfigError, BuildWorkflowError } from './errors';
import { evaluateIfCondition } from './utils/jsepEval';

/**
 * One AUTHORED hook step, constructed but not executed. A `uses:` function
 * group hook step's whole expansion lives in one entry's `steps` array (that
 * is what lets the hook metric emit one event per authored step and aggregate
 * its result), and the authored step's `if:` rides on the entry: group
 * expansion drops an outer `if:`, so the executor evaluates `ifCondition`
 * once before executing the entry's steps. Plain `run:` and single-function
 * entries keep their step-level `if:` instead (`ifCondition` stays unset).
 * Entry conditions evaluate against the global context only — a group call's
 * `with:` inputs are not visible to them.
 */
export interface HookEntry {
  steps: BuildStep[];
  kind: 'run' | 'uses';
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
 * Sets every hook step's display status to skipped without evaluating
 * conditions (display parity with the anchor's own skip).
 */
export function skipHookEntries(entries: readonly HookEntry[]): void {
  for (const entry of entries) {
    for (const step of entry.steps) {
      step.skip();
    }
  }
}

/**
 * The canonical message for an `if:` that could not be evaluated — the same
 * copy for anchor steps, hook steps, and hook group entries, so the three call
 * sites cannot drift.
 */
export function logConditionEvaluationError(
  logger: bunyan,
  err: unknown,
  subject: string,
  ifCondition: string | undefined
): void {
  logger.error({ err });
  logger.error(
    `Runner failed to evaluate if it should execute ${subject}, using its if condition "${ifCondition}". This can be caused by trying to access non-existing object property. If you think this is a bug report it here: https://github.com/expo/eas-cli/issues.`
  );
}

/**
 * Constructs hook entries from authored hook steps: ONE authored step → ONE
 * entry, anchor discovery disabled (a hook step invoking an anchored function
 * or a function group never becomes an anchor itself — no nesting). Validates
 * step shapes and function existence; the aggregate (cross-key) validation is
 * `validateHookStepsAsync`.
 *
 * The parser uses the internal `constructHookEntriesFromValidatedSteps` with
 * its own maps.
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

/**
 * Executes hook entries around an anchor. Catches condition-evaluation errors
 * AND execution errors, marks global failure, preserves the FIRST local
 * error, and reports the `WorkflowHookMetric` per executed authored entry.
 *
 * Default-run rules (a step or entry with no `if:`):
 * - `before`: runs unless a failure occurred within THIS hook sequence — the
 *   explicit `failedLocally` state, never a global-flag delta (the flag may
 *   already be true when the anchor passed via `always()`). Failure state
 *   predating the anchor's gate decision (`baselineFailure`) is ignored,
 *   as required by the "runs iff the anchor runs" invariant.
 * - `after`: runs unconditionally — past the anchor's own failure AND past an
 *   earlier after-entry's failure.
 * A user `if:` is always evaluated against the real global context, so
 * `failure()` / `success()` keep their global meaning on both sides.
 */
export async function executeHookStepsAsync(
  ctx: BuildStepGlobalContext,
  entries: HookEntry[],
  options: {
    anchor: HookAnchorId;
    timing: 'before' | 'after';
    /**
     * The global failure state captured BEFORE the anchor's gate decision.
     * Defaults to the state at call time. Only failures occurring after this
     * baseline make no-`if:` before-entries skip.
     */
    baselineFailure?: boolean;
    /** The anchor's LOCAL outcome; set by the caller on after-timing calls. */
    anchorResult?: StepMetricResult;
  }
): Promise<{ failedLocally: boolean; firstError: unknown }> {
  const baselineFailure = options.baselineFailure ?? ctx.hasAnyPreviousStepFailed;
  let failedLocally = false;
  let firstError: unknown;
  const recordFailure = (err: unknown): void => {
    if (!failedLocally) {
      failedLocally = true;
      firstError = err;
    }
    ctx.markAsFailed();
  };
  // A no-if step is eligible unless a failure occurred after the baseline:
  // tracked locally, with the global flag as a backstop only when it can
  // still move (a saturated flag carries no delta information).
  const noNewFailure = (): boolean =>
    !failedLocally && (baselineFailure || !ctx.hasAnyPreviousStepFailed);

  for (const entry of entries) {
    // Truthiness, not presence: an empty `if:` means "no condition", the same
    // as BuildStep.shouldExecuteStep treats it.
    const entryHasExplicitCondition = Boolean(entry.ifCondition);
    if (entry.ifCondition) {
      let entryEligible = false;
      try {
        entryEligible = evaluateEntryIfCondition(ctx, entry.ifCondition);
      } catch (err) {
        logConditionEvaluationError(
          entry.steps[0]?.ctx.logger ?? ctx.baseLogger,
          err,
          'the hook group step',
          entry.ifCondition
        );
        recordFailure(err);
        skipHookEntries([entry]);
        continue;
      }
      if (!entryEligible) {
        skipHookEntries([entry]);
        continue;
      }
    }

    let anyStepExecuted = false;
    let entryFailed = false;
    for (const step of entry.steps) {
      let shouldExecuteStep = false;
      if (step.ifCondition) {
        try {
          shouldExecuteStep = step.shouldExecuteStep();
        } catch (err) {
          logConditionEvaluationError(
            step.ctx.logger,
            err,
            `step "${step.displayName}"`,
            step.ifCondition
          );
          recordFailure(err);
          entryFailed = true;
        }
      } else {
        // After-side no-if steps run unconditionally — past sibling failures
        // too. Before-side: an entry whose explicit condition evaluated true
        // behaves like a single step whose if: passed — its no-if children
        // ignore failures from EARLIER entries (only within-entry failures
        // skip them).
        shouldExecuteStep =
          options.timing === 'after' || (entryHasExplicitCondition ? !entryFailed : noNewFailure());
      }
      if (!shouldExecuteStep) {
        step.skip();
        continue;
      }
      anyStepExecuted = true;
      const startTime = performance.now();
      let stepResult: StepMetricResult = 'success';
      try {
        await step.executeAsync();
      } catch (err) {
        stepResult = 'failed';
        entryFailed = true;
        recordFailure(err);
      } finally {
        ctx.collectStepMetric(step, stepResult, performance.now() - startTime);
      }
    }

    if (anyStepExecuted) {
      try {
        ctx.reportWorkflowHookMetric({
          anchor: options.anchor,
          timing: options.timing,
          kind: entry.kind,
          result: entryFailed ? 'failed' : 'success',
          ...(options.anchorResult !== undefined ? { anchorResult: options.anchorResult } : null),
        });
      } catch (err) {
        // Telemetry must never fail the job or mask a step's error.
        ctx.baseLogger.debug({ err }, 'Reporting the workflow hook metric failed');
      }
    }
  }

  return { failedLocally, firstError };
}

// The no-input variant of a step-level `if:` (a group hook entry has no step
// to hang the authored condition on).
function evaluateEntryIfCondition(ctx: BuildStepGlobalContext, ifCondition: string): boolean {
  return evaluateIfCondition(ifCondition, {
    inputs: {},
    eas: {
      runtimePlatform: ctx.runtimePlatform,
      ...ctx.staticContext,
      env: ctx.env,
    },
    ...ctx.getInterpolationContext(),
  });
}

/**
 * Package-internal: entry construction over already-validated steps and
 * already-built function maps (the parser path; the public
 * `constructHookEntriesAsync` validates and builds the maps first).
 */
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
        kind: 'run',
      });
      continue;
    }
    const maybeFunctionGroup = buildFunctionGroupById[step.uses];
    if (maybeFunctionGroup !== undefined) {
      // The group call vanishes at expansion, so the authored `if:` rides on
      // the entry. The expanded steps never become anchors (no nesting):
      // entry construction performs no anchor discovery at all.
      entries.push({
        steps: maybeFunctionGroup.createBuildStepsFromFunctionGroupCall(ctx, {
          callInputs: step.with,
        }),
        kind: 'uses',
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
      kind: 'uses',
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

/** Package-internal: every `uses:` in `steps` must name a known function or group. */
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
    if (step.uses) {
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
