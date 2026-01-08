import { BuildStepGlobalContext } from './BuildStepContext.js';
import { BuildStepRuntimeError } from './errors.js';

export type BuildStepOutputById = Record<string, BuildStepOutput>;
export type BuildStepOutputProvider = (
  ctx: BuildStepGlobalContext,
  stepDisplayName: string
) => BuildStepOutput;

interface BuildStepOutputProviderParams<R extends boolean = boolean> {
  id: string;
  required: R;
}

interface BuildStepOutputParams<R extends boolean = boolean>
  extends BuildStepOutputProviderParams<R> {
  stepDisplayName: string;
}

type BuildStepOutputValueType<R extends boolean = boolean> = R extends true
  ? string
  : string | undefined;

export interface SerializedBuildStepOutput<R extends boolean = boolean> {
  id: string;
  stepDisplayName: string;
  required: R;
  value?: string;
}

export class BuildStepOutput<R extends boolean = boolean> {
  public readonly id: string;
  public readonly stepDisplayName: string;
  public readonly required: R;

  private _value?: string;

  public static createProvider(params: BuildStepOutputProviderParams): BuildStepOutputProvider {
    return (ctx, stepDisplayName) => new BuildStepOutput(ctx, { ...params, stepDisplayName });
  }

  constructor(
    // @ts-expect-error ctx is not used in this class but let's keep it here for consistency
    private readonly ctx: BuildStepGlobalContext | undefined,
    { id, stepDisplayName, required }: BuildStepOutputParams<R>
  ) {
    this.id = id;
    this.stepDisplayName = stepDisplayName;
    this.required = required;
  }

  public get rawValue(): string | undefined {
    return this._value;
  }

  public get value(): BuildStepOutputValueType<R> {
    if (this.required && this._value === undefined) {
      throw new BuildStepRuntimeError(
        `Output parameter "${this.id}" for step "${this.stepDisplayName}" is required but it was not set.`
      );
    }
    return this._value as BuildStepOutputValueType<R>;
  }

  public set(value: BuildStepOutputValueType<R>): BuildStepOutput {
    if (this.required && value === undefined) {
      throw new BuildStepRuntimeError(
        `Output parameter "${this.id}" for step "${this.stepDisplayName}" is required.`
      );
    }
    this._value = value;
    return this;
  }

  public serialize(): SerializedBuildStepOutput {
    return {
      id: this.id,
      stepDisplayName: this.stepDisplayName,
      required: this.required,
      value: this._value,
    };
  }

  public static deserialize(serialized: SerializedBuildStepOutput): BuildStepOutput {
    const deserialized = new BuildStepOutput(undefined, {
      id: serialized.id,
      stepDisplayName: serialized.stepDisplayName,
      required: serialized.required,
    });
    deserialized._value = serialized.value;
    return deserialized;
  }
}

export function makeBuildStepOutputByIdMap(outputs?: BuildStepOutput[]): BuildStepOutputById {
  if (outputs === undefined) {
    return {};
  }
  return outputs.reduce((acc, output) => {
    acc[output.id] = output;
    return acc;
  }, {} as BuildStepOutputById);
}
