import { BuildFunctionCallInputs } from './BuildFunction';
import { BuildStep } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import {
  BuildStepInputById,
  BuildStepInputProvider,
  makeBuildStepInputByIdMap,
} from './BuildStepInput';
import { BuildConfigError } from './errors';

export type BuildFunctionGroupById = Record<string, BuildFunctionGroup | undefined>;

export class BuildFunctionGroup {
  public readonly namespace: string;
  public readonly id: string;
  public readonly inputProviders?: BuildStepInputProvider[];
  public readonly createBuildStepsFromFunctionGroupCall: (
    globalCtx: BuildStepGlobalContext,
    options?: {
      callInputs?: BuildFunctionCallInputs;
    }
  ) => BuildStep[];

  constructor({
    namespace,
    id,
    inputProviders,
    createBuildStepsFromFunctionGroupCall,
  }: {
    namespace: string;
    id: string;
    inputProviders?: BuildStepInputProvider[];
    createBuildStepsFromFunctionGroupCall: (
      globalCtx: BuildStepGlobalContext,
      {
        inputs,
      }: {
        inputs: BuildStepInputById;
      }
    ) => BuildStep[];
  }) {
    this.namespace = namespace;
    this.id = id;
    this.inputProviders = inputProviders;

    this.createBuildStepsFromFunctionGroupCall = (ctx, { callInputs = {} } = {}) => {
      const inputs = this.inputProviders?.map((inputProvider) => {
        const input = inputProvider(ctx, id);
        if (input.id in callInputs) {
          input.set(callInputs[input.id]);
        }
        return input;
      });
      return createBuildStepsFromFunctionGroupCall(ctx, {
        inputs: makeBuildStepInputByIdMap(inputs),
      });
    };
  }

  public getFullId(): string {
    return this.namespace === undefined ? this.id : `${this.namespace}/${this.id}`;
  }
}

export function createBuildFunctionGroupByIdMapping(
  buildFunctionGroups: BuildFunctionGroup[]
): BuildFunctionGroupById {
  const buildFunctionGroupById: BuildFunctionGroupById = {};
  for (const buildFunctionGroup of buildFunctionGroups) {
    if (buildFunctionGroupById[buildFunctionGroup.getFullId()] !== undefined) {
      throw new BuildConfigError(
        `Build function group with id ${buildFunctionGroup.getFullId()} is already defined.`
      );
    }
    buildFunctionGroupById[buildFunctionGroup.getFullId()] = buildFunctionGroup;
  }
  return buildFunctionGroupById;
}
