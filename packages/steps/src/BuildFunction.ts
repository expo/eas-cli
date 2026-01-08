import assert from 'assert';

import { BuildRuntimePlatform } from './BuildRuntimePlatform';
import { BuildStep, BuildStepFunction } from './BuildStep';
import { BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepInputProvider } from './BuildStepInput';
import { BuildStepOutputProvider } from './BuildStepOutput';
import { BuildStepEnv } from './BuildStepEnv';
import { createCustomFunctionCall } from './utils/customFunction';

export type BuildFunctionById = Record<string, BuildFunction>;
export type BuildFunctionCallInputs = Record<string, unknown>;

export class BuildFunction {
  public readonly namespace?: string;
  public readonly id: string;
  public readonly name?: string;
  public readonly supportedRuntimePlatforms?: BuildRuntimePlatform[];
  public readonly inputProviders?: BuildStepInputProvider[];
  public readonly outputProviders?: BuildStepOutputProvider[];
  public readonly command?: string;
  public readonly customFunctionModulePath?: string;
  public readonly fn?: BuildStepFunction;
  public readonly shell?: string;
  public readonly __metricsId?: string;

  constructor({
    namespace,
    id,
    name,
    supportedRuntimePlatforms,
    inputProviders,
    outputProviders,
    command,
    fn,
    customFunctionModulePath,
    shell,
    __metricsId,
  }: {
    namespace?: string;
    id: string;
    name?: string;
    supportedRuntimePlatforms?: BuildRuntimePlatform[];
    inputProviders?: BuildStepInputProvider[];
    outputProviders?: BuildStepOutputProvider[];
    command?: string;
    customFunctionModulePath?: string;
    fn?: BuildStepFunction;
    shell?: string;
    __metricsId?: string;
  }) {
    assert(
      command !== undefined || fn !== undefined || customFunctionModulePath !== undefined,
      'Either command, fn or path must be defined.'
    );

    assert(!(command !== undefined && fn !== undefined), 'Command and fn cannot be both set.');
    assert(
      !(command !== undefined && customFunctionModulePath !== undefined),
      'Command and path cannot be both set.'
    );
    assert(
      !(fn !== undefined && customFunctionModulePath !== undefined),
      'Fn and path cannot be both set.'
    );

    this.namespace = namespace;
    this.id = id;
    this.name = name;
    this.supportedRuntimePlatforms = supportedRuntimePlatforms;
    this.inputProviders = inputProviders;
    this.outputProviders = outputProviders;
    this.command = command;
    this.fn = fn;
    this.shell = shell;
    this.customFunctionModulePath = customFunctionModulePath;
    this.__metricsId = __metricsId;
  }

  public getFullId(): string {
    return this.namespace === undefined ? this.id : `${this.namespace}/${this.id}`;
  }

  public createBuildStepFromFunctionCall(
    ctx: BuildStepGlobalContext,
    {
      id,
      name,
      callInputs = {},
      workingDirectory,
      shell,
      env,
      ifCondition,
      timeoutMs,
    }: {
      id?: string;
      name?: string;
      callInputs?: BuildFunctionCallInputs;
      workingDirectory?: string;
      shell?: string;
      env?: BuildStepEnv;
      ifCondition?: string;
      timeoutMs?: number;
    } = {}
  ): BuildStep {
    const buildStepId = BuildStep.getNewId(id);
    const buildStepName = name ?? this.name;
    const buildStepDisplayName = BuildStep.getDisplayName({
      id: buildStepId,
      command: this.command,
      name: buildStepName,
    });

    const inputs = this.inputProviders?.map((inputProvider) => {
      const input = inputProvider(ctx, buildStepId);
      if (input.id in callInputs) {
        input.set(callInputs[input.id]);
      }
      return input;
    });
    const outputs = this.outputProviders?.map((outputProvider) => outputProvider(ctx, buildStepId));

    return new BuildStep(ctx, {
      id: buildStepId,
      name: buildStepName,
      displayName: buildStepDisplayName,
      command: this.command,
      fn:
        this.fn ??
        (this.customFunctionModulePath
          ? createCustomFunctionCall(this.customFunctionModulePath)
          : undefined),
      workingDirectory,
      inputs,
      outputs,
      shell,
      supportedRuntimePlatforms: this.supportedRuntimePlatforms,
      env,
      ifCondition,
      timeoutMs,
      __metricsId: this.__metricsId,
    });
  }
}
