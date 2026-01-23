import assert from 'node:assert';

import {
  FunctionStep,
  isStepFunctionStep,
  isStepShellStep,
  ShellStep,
  Step,
  validateSteps,
} from '@expo/eas-build-job';

import { BuildFunction, BuildFunctionById } from './BuildFunction';
import {
  BuildFunctionGroup,
  BuildFunctionGroupById,
  createBuildFunctionGroupByIdMapping,
} from './BuildFunctionGroup';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStep } from './BuildStep';
import { AbstractConfigParser } from './AbstractConfigParser';
import { BuildConfigError } from './errors';
import { BuildStepOutput } from './BuildStepOutput';

export class StepsConfigParser extends AbstractConfigParser {
  private readonly steps: Step[];

  constructor(
    ctx: BuildStepGlobalContext,
    {
      steps,
      externalFunctions,
      externalFunctionGroups,
    }: {
      steps: Step[];
      externalFunctions?: BuildFunction[];
      externalFunctionGroups?: BuildFunctionGroup[];
    }
  ) {
    super(ctx, {
      externalFunctions,
      externalFunctionGroups,
    });

    this.steps = steps;
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
    {
      buildFunctionById,
      buildFunctionGroupById,
    }: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
    }
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
    const displayName = BuildStep.getDisplayName({ id, name: step.name, command: step.run });
    const outputs =
      step.outputs && this.createBuildStepOutputsFromDefinition(step.outputs, displayName);
    return new BuildStep(this.ctx, {
      id,
      outputs,
      name: step.name,
      displayName,
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
    {
      buildFunctionById,
      buildFunctionGroupById,
    }: {
      buildFunctionById: BuildFunctionById;
      buildFunctionGroupById: BuildFunctionGroupById;
    }
  ): BuildStep[] {
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

  private createBuildStepOutputsFromDefinition(
    stepOutputs: Required<ShellStep>['outputs'],
    stepDisplayName: string
  ): BuildStepOutput[] {
    return stepOutputs.map(
      (entry) =>
        new BuildStepOutput(this.ctx, {
          id: entry.name,
          stepDisplayName,
          required: entry.required ?? true,
        })
    );
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
    const calledFunctionsOrFunctionGroupsSet = new Set<string>();
    for (const step of steps) {
      if (step.uses) {
        calledFunctionsOrFunctionGroupsSet.add(step.uses);
      }
    }
    const calledFunctionsOrFunctionGroup = Array.from(calledFunctionsOrFunctionGroupsSet);
    const externalFunctionIdsSet = new Set(externalFunctionIds);
    const externalFunctionGroupsIdsSet = new Set(externalFunctionGroupIds);
    const nonExistentFunctionsOrFunctionGroups = calledFunctionsOrFunctionGroup.filter(
      (calledFunctionOrFunctionGroup) => {
        return (
          !externalFunctionIdsSet.has(calledFunctionOrFunctionGroup) &&
          !externalFunctionGroupsIdsSet.has(calledFunctionOrFunctionGroup)
        );
      }
    );
    if (nonExistentFunctionsOrFunctionGroups.length > 0) {
      throw new BuildConfigError(
        `Calling non-existent functions: ${nonExistentFunctionsOrFunctionGroups
          .map((f) => `"${f}"`)
          .join(', ')}.`
      );
    }
  }
}
