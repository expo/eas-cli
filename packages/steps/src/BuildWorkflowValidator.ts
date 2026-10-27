import fs from 'fs-extra';
import path from 'path';

import { BuildRuntimePlatform } from './BuildRuntimePlatform';
import { BuildStep } from './BuildStep';
import { BuildStepInputValueTypeName, getDisallowedInputValueError } from './BuildStepInput';
// Type-only to keep the runtime module graph acyclic (BuildWorkflow imports
// hooks.ts, which imports this module for the shared aggregate checks).
import type { BuildWorkflow } from './BuildWorkflow';
import { BuildConfigError, BuildWorkflowError } from './errors';
import { duplicates } from './utils/expodash/duplicates';
import { nullthrows } from './utils/nullthrows';
import { findOutputPaths } from './utils/template';

export class BuildWorkflowValidator {
  constructor(private readonly workflow: BuildWorkflow) {}

  public async validateAsync(): Promise<void> {
    // Hook steps don't join buildSteps, so validation is NOT free for them:
    // every aggregate check runs over the execution-ordered view (before →
    // anchor → after per occurrence), or hook steps would silently escape
    // id-uniqueness, output-reference, and platform validation.
    const orderedView = this.workflow.getExecutionOrderedSteps();
    const errors: BuildConfigError[] = [];
    errors.push(
      ...collectAggregateStepErrors(orderedView, {
        runtimePlatform: this.workflow.runtimePlatform,
      })
    );
    errors.push(...(await this.validateCustomFunctionModulesAsync()));
    if (errors.length !== 0) {
      throw new BuildWorkflowError('Build workflow is invalid.', errors);
    }
  }

  private async validateCustomFunctionModulesAsync(): Promise<BuildConfigError[]> {
    const errors: BuildConfigError[] = [];
    for (const buildFunction of Object.values(this.workflow.buildFunctions)) {
      if (!buildFunction.customFunctionModulePath) {
        continue;
      }

      if (!(await fs.exists(buildFunction.customFunctionModulePath))) {
        const error = new BuildConfigError(
          `Custom function module path "${buildFunction.customFunctionModulePath}" for function "${buildFunction.id}" does not exist.`
        );
        errors.push(error);
        continue;
      }

      if (!(await fs.exists(path.join(buildFunction.customFunctionModulePath, 'package.json')))) {
        const error = new BuildConfigError(
          `Custom function module path "${buildFunction.customFunctionModulePath}" for function "${buildFunction.id}" does not contain a package.json file.`
        );
        errors.push(error);
      }
    }
    return errors;
  }
}

/**
 * The aggregate step checks (unique ids, input/output references, runtime
 * platform allowance) over an execution-ordered view of steps. Shared by the
 * workflow validator and `validateHookStepsAsync`.
 */
export function collectAggregateStepErrors(
  steps: readonly BuildStep[],
  { runtimePlatform }: { runtimePlatform: BuildRuntimePlatform }
): BuildConfigError[] {
  return [
    ...validateUniqueStepIds(steps),
    ...validateInputs(steps),
    ...validateAllowedPlatforms(steps, runtimePlatform),
  ];
}

function validateUniqueStepIds(steps: readonly BuildStep[]): BuildConfigError[] {
  const stepIds = steps.map(({ id }) => id);
  const duplicatedStepIds = duplicates(stepIds);
  if (duplicatedStepIds.length === 0) {
    return [];
  } else {
    const error = new BuildConfigError(
      `Duplicated step IDs: ${duplicatedStepIds.map(i => `"${i}"`).join(', ')}`
    );
    return [error];
  }
}

function validateInputs(steps: readonly BuildStep[]): BuildConfigError[] {
  const errors: BuildConfigError[] = [];

  const allStepIds = new Set(steps.map(s => s.id));
  const visitedStepByStepId: Record<string, BuildStep> = {};
  for (const currentStep of steps) {
    for (const currentStepInput of currentStep.inputs ?? []) {
      if (currentStepInput.required && currentStepInput.rawValue === undefined) {
        const error = new BuildConfigError(
          `Input parameter "${currentStepInput.id}" for step "${currentStep.displayName}" is required but it was not set.`
        );
        errors.push(error);
      }

      const currentType =
        typeof currentStepInput.rawValue === 'object'
          ? BuildStepInputValueTypeName.JSON
          : typeof currentStepInput.rawValue;
      if (
        currentStepInput.rawValue !== undefined &&
        !currentStepInput.isRawValueStepOrContextReference() &&
        currentType !== currentStepInput.allowedValueTypeName
      ) {
        const error = new BuildConfigError(
          `Input parameter "${currentStepInput.id}" for step "${
            currentStep.displayName
          }" is set to "${
            typeof currentStepInput.rawValue === 'object'
              ? JSON.stringify(currentStepInput.rawValue)
              : currentStepInput.rawValue
          }" which is not of type "${
            currentStepInput.allowedValueTypeName
          }" or is not step or context reference.`
        );
        errors.push(error);
      }

      if (currentStepInput.defaultValue === undefined) {
        continue;
      }
      const disallowedValueError = getDisallowedInputValueError(
        currentStepInput,
        currentStep.displayName
      );
      if (disallowedValueError) {
        errors.push(new BuildConfigError(disallowedValueError));
      }
      const paths =
        typeof currentStepInput.defaultValue === 'string'
          ? findOutputPaths(currentStepInput.defaultValue)
          : [];
      for (const { stepId: referencedStepId, outputId: referencedStepOutputId } of paths) {
        if (!(referencedStepId in visitedStepByStepId)) {
          if (allStepIds.has(referencedStepId)) {
            const error = new BuildConfigError(
              `Input parameter "${currentStepInput.id}" for step "${currentStep.displayName}" uses an expression that references an output parameter from the future step "${referencedStepId}".`
            );
            errors.push(error);
          } else {
            const error = new BuildConfigError(
              `Input parameter "${currentStepInput.id}" for step "${currentStep.displayName}" uses an expression that references an output parameter from a non-existent step "${referencedStepId}".`
            );
            errors.push(error);
          }
        } else {
          if (!visitedStepByStepId[referencedStepId].hasOutputParameter(referencedStepOutputId)) {
            const error = new BuildConfigError(
              `Input parameter "${currentStepInput.id}" for step "${currentStep.displayName}" uses an expression that references an undefined output parameter "${referencedStepOutputId}" from step "${referencedStepId}".`
            );
            errors.push(error);
          }
        }
      }
    }
    visitedStepByStepId[currentStep.id] = currentStep;
  }

  return errors;
}

function validateAllowedPlatforms(
  steps: readonly BuildStep[],
  runtimePlatform: BuildRuntimePlatform
): BuildConfigError[] {
  const errors: BuildConfigError[] = [];
  for (const step of steps) {
    if (!step.canBeRunOnRuntimePlatform()) {
      const error = new BuildConfigError(
        `Step "${step.displayName}" is not allowed on platform "${runtimePlatform}". Allowed platforms for this step are: ${nullthrows(
          step.supportedRuntimePlatforms,
          `step.supportedRuntimePlatforms can't be falsy if canBeRunOnRuntimePlatform() is false`
        )
          .map(p => `"${p}"`)
          .join(', ')}.`
      );
      errors.push(error);
    }
  }
  return errors;
}
