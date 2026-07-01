import {
  ActionCatalog,
  FunctionStep,
  ShellStep,
  Step,
  isActionReference,
  isStepFunctionStep,
  isStepShellStep,
  parseActionReference,
  validateSteps,
} from '@expo/eas-build-job';
import assert from 'node:assert';

import { AbstractConfigParser } from './AbstractConfigParser';
import { BuildFunction, BuildFunctionById } from './BuildFunction';
import { BuildFunctionGroup, createBuildFunctionGroupByIdMapping } from './BuildFunctionGroup';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildConfigError } from './errors';
import { ActionExpander, FunctionMaps } from './ActionExpander';
import { createBuildStepOutputsFromDefinition, getShellStepDisplayName } from './utils/step';

export class StepsConfigParser extends AbstractConfigParser {
  private readonly steps: Step[];
  private readonly actionExpander: ActionExpander;

  constructor(
    ctx: BuildStepGlobalContext,
    {
      steps,
      externalFunctions,
      externalFunctionGroups,
      actionCatalog,
    }: {
      steps: Step[];
      externalFunctions?: BuildFunction[];
      externalFunctionGroups?: BuildFunctionGroup[];
      actionCatalog?: ActionCatalog;
    }
  ) {
    super(ctx, {
      externalFunctions,
      externalFunctionGroups,
    });

    this.steps = steps;
    this.actionExpander = new ActionExpander(ctx, actionCatalog ?? {});
  }

  protected async parseConfigToBuildStepsAndBuildFunctionByIdMappingAsync(): Promise<{
    buildSteps: BuildStep[];
    buildFunctionById: BuildFunctionById;
  }> {
    const validatedSteps = validateSteps(this.steps);
    StepsConfigParser.validateAllFunctionsExist(validatedSteps, {
      externalFunctionIds: this.getExternalFunctionFullIds(),
      externalFunctionGroupIds: this.getExternalFunctionGroupFullIds(),
    });

    const buildFunctionById = this.createBuildFunctionByIdMappingForExternalFunctions();
    const buildFunctionGroupById = createBuildFunctionGroupByIdMapping(
      this.externalFunctionGroups ?? []
    );

    const buildSteps: BuildStep[] = [];
    for (const stepConfig of validatedSteps) {
      buildSteps.push(
        ...this.createBuildStepsFromStepConfig(stepConfig, {
          buildFunctionById,
          buildFunctionGroupById,
        })
      );
    }

    return {
      buildSteps,
      buildFunctionById,
    };
  }

  private createBuildFunctionByIdMappingForExternalFunctions(): BuildFunctionById {
    const result: BuildFunctionById = {};

    if (this.externalFunctions === undefined) {
      return result;
    }

    for (const buildFunction of this.externalFunctions) {
      const fullId = buildFunction.getFullId();
      result[fullId] = buildFunction;
    }
    return result;
  }

  private createBuildStepsFromStepConfig(
    stepConfig: Step,
    { buildFunctionById, buildFunctionGroupById }: FunctionMaps
  ): BuildStep[] {
    if (isStepShellStep(stepConfig)) {
      return [this.createBuildStepFromShellStepConfig(stepConfig)];
    } else if (isStepFunctionStep(stepConfig)) {
      return this.createBuildStepsFromFunctionStepConfig(stepConfig, {
        buildFunctionById,
        buildFunctionGroupById,
      });
    } else {
      throw new BuildConfigError(
        'Invalid job step configuration detected. Step must be shell or function step'
      );
    }
  }

  private createBuildStepFromShellStepConfig(step: ShellStep): BuildStep {
    const id = BuildStep.getNewId(step.id);
    const displayName = getShellStepDisplayName(step);
    const outputs =
      step.outputs && createBuildStepOutputsFromDefinition(this.ctx, step.outputs, displayName);
    return new BuildStep(this.ctx, {
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

  private createBuildStepsFromFunctionStepConfig(
    step: FunctionStep,
    { buildFunctionById, buildFunctionGroupById }: FunctionMaps
  ): BuildStep[] {
    if (isActionReference(step.uses)) {
      const parsed = parseActionReference(step.uses);
      if (!parsed) {
        throw new BuildConfigError(`Invalid action reference "${step.uses}".`);
      }
      return this.actionExpander.expandActionCall(
        {
          ref: parsed.ref,
          syntheticStepId: BuildStep.getNewId(step.id),
          callWith: step.with,
          inheritedEnv: step.env,
          inheritedIf: step.if,
          inheritedWorkingDirectory: step.working_directory,
        },
        { buildFunctionById, buildFunctionGroupById }
      );
    }

    const functionId = step.uses;
    const maybeFunctionGroup = buildFunctionGroupById[functionId];
    if (maybeFunctionGroup) {
      // TODO: allow to set id, name, working_directory, shell, env and if for function groups
      return maybeFunctionGroup.createBuildStepsFromFunctionGroupCall(this.ctx, {
        callInputs: step.with,
      });
    }

    const buildFunction = buildFunctionById[functionId];
    assert(buildFunction, 'function ID must be ID of function or function group');

    return [
      buildFunction.createBuildStepFromFunctionCall(this.ctx, {
        id: step.id,
        name: step.name,
        callInputs: step.with,
        workingDirectory: step.working_directory,
        shell: step.shell,
        env: step.env,
        ifCondition: step.if,
      }),
    ];
  }

  private static validateAllFunctionsExist(
    steps: Step[],
    {
      externalFunctionIds,
      externalFunctionGroupIds,
    }: {
      externalFunctionIds: string[];
      externalFunctionGroupIds: string[];
    }
  ): void {
    const externalFunctionIdsSet = new Set(externalFunctionIds);
    const externalFunctionGroupIdsSet = new Set(externalFunctionGroupIds);

    const calledFunctionsOrFunctionGroupsSet = new Set<string>();
    for (const step of steps) {
      if (step.uses && !isActionReference(step.uses)) {
        calledFunctionsOrFunctionGroupsSet.add(step.uses);
      }
    }
    const calledFunctionsOrFunctionGroup = Array.from(calledFunctionsOrFunctionGroupsSet);
    const nonExistentFunctionsOrFunctionGroups = calledFunctionsOrFunctionGroup.filter(
      calledFunctionOrFunctionGroup => {
        return (
          !externalFunctionIdsSet.has(calledFunctionOrFunctionGroup) &&
          !externalFunctionGroupIdsSet.has(calledFunctionOrFunctionGroup)
        );
      }
    );
    if (nonExistentFunctionsOrFunctionGroups.length > 0) {
      throw new BuildConfigError(
        `Calling non-existent functions: ${nonExistentFunctionsOrFunctionGroups
          .map(f => `"${f}"`)
          .join(', ')}.`
      );
    }
  }
}
