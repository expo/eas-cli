import { HookAnchorId, JobInterpolationContext } from '@expo/eas-build-job';
import assert from 'assert';
import { Buffer } from 'buffer';
import fs from 'fs/promises';
import path from 'path';
import util from 'util';

import { BuildRuntimePlatform } from './BuildRuntimePlatform';
import { BuildStepCompositeFunctionScope } from './BuildStepCompositeFunctionScope';
import { BuildStepContext, BuildStepGlobalContext } from './BuildStepContext';
import { BuildStepEnv } from './BuildStepEnv';
import { BuildStepInput, BuildStepInputById, makeBuildStepInputByIdMap } from './BuildStepInput';
import {
  BuildStepOutput,
  BuildStepOutputById,
  SerializedBuildStepOutput,
  makeBuildStepOutputByIdMap,
} from './BuildStepOutput';
import {
  cleanUpStepTemporaryDirectoriesAsync,
  getTemporaryEnvsDirPath,
  getTemporaryOutputsDirPath,
  saveScriptToTemporaryFileAsync,
} from './BuildTemporaryFiles';
import { BuildStepRuntimeError } from './errors';
import { interpolateJobContext } from './interpolation';
import {
  containsUnresolvedTemplateReference,
  resolveInterpolatedTarget,
  stringifyInterpolatedResult,
  stringifyOptionalInterpolatedResult,
} from './utils/compositeFunctionInterpolation';
import { evaluateIfCondition as evaluateIfConditionExpression } from './utils/jsepEval';
import { BIN_PATH } from './utils/shell/bin';
import { getShellCommandAndArgs } from './utils/shell/command';
import { spawnAsync } from './utils/shell/spawn';
import { interpolateWithInputs, interpolateWithOutputs } from './utils/template';

export enum BuildStepStatus {
  NEW = 'new',
  IN_PROGRESS = 'in-progress',
  SKIPPED = 'skipped',
  FAIL = 'fail',
  WARNING = 'warning',
  SUCCESS = 'success',
}

export enum BuildStepLogMarker {
  START_STEP = 'start-step',
  END_STEP = 'end-step',
}

export type BuildStepFunction = (
  ctx: BuildStepContext,
  {
    inputs,
    outputs,
    env,
  }: {
    inputs: { [key: string]: { value: unknown } };
    outputs: BuildStepOutputById;
    env: BuildStepEnv;
    signal?: AbortSignal;
  }
) => unknown;

export interface SerializedBuildStepOutputAccessor {
  id: string;
  executed: boolean;
  outputById: Record<string, SerializedBuildStepOutput>;
  displayName: string;
}

export class BuildStepOutputAccessor {
  constructor(
    public readonly id: string,
    public readonly displayName: string,
    protected readonly executed: boolean,
    protected readonly outputById: BuildStepOutputById
  ) {}

  public get outputs(): BuildStepOutput[] {
    return Object.values(this.outputById);
  }

  public getOutputValueByName(name: string): string | undefined {
    if (!this.executed) {
      throw new BuildStepRuntimeError(
        `Failed getting output "${name}" from step "${this.displayName}". The step has not been executed yet.`
      );
    }
    if (!this.hasOutputParameter(name)) {
      throw new BuildStepRuntimeError(`Step "${this.displayName}" does not have output "${name}".`);
    }
    return this.outputById[name].value;
  }

  public hasOutputParameter(name: string): boolean {
    return name in this.outputById;
  }

  public serialize(): SerializedBuildStepOutputAccessor {
    return {
      id: this.id,
      executed: this.executed,
      outputById: Object.fromEntries(
        Object.entries(this.outputById).map(([key, value]) => [key, value.serialize()])
      ),
      displayName: this.displayName,
    };
  }

  public static deserialize(
    serialized: SerializedBuildStepOutputAccessor
  ): BuildStepOutputAccessor {
    const outputById = Object.fromEntries(
      Object.entries(serialized.outputById).map(([key, value]) => [
        key,
        BuildStepOutput.deserialize(value),
      ])
    );
    return new BuildStepOutputAccessor(
      serialized.id,
      serialized.displayName,
      serialized.executed,
      outputById
    );
  }
}

export class BuildStep extends BuildStepOutputAccessor {
  private static nextGeneratedId = 1;
  public readonly id: string;
  public readonly displayName: string;
  public readonly supportedRuntimePlatforms?: BuildRuntimePlatform[];
  public readonly inputs?: BuildStepInput[];
  public readonly outputById: BuildStepOutputById;
  public readonly command?: string;
  public readonly fn?: BuildStepFunction;
  public readonly shell: string;
  public readonly ctx: BuildStepContext;
  public readonly stepEnvOverrides: BuildStepEnv;
  public readonly ifCondition?: string;
  public readonly compositeFunctionScope?: BuildStepCompositeFunctionScope;
  public readonly timeoutMs?: number;
  public readonly __metricsId?: string;
  public readonly __hookId?: HookAnchorId;
  public status: BuildStepStatus;
  private readonly outputsDir: string;
  private readonly envsDir: string;

  private readonly inputById: BuildStepInputById;
  protected executed = false;

  public static getNewId(userDefinedId?: string): string {
    return userDefinedId ?? `step-${String(BuildStep.nextGeneratedId++).padStart(3, '0')}`;
  }

  constructor(
    ctx: BuildStepGlobalContext,
    {
      id,
      displayName,
      inputs,
      outputs,
      command,
      fn,
      workingDirectory: maybeWorkingDirectory,
      shell,
      supportedRuntimePlatforms: maybeSupportedRuntimePlatforms,
      env,
      ifCondition,
      compositeFunctionScope,
      timeoutMs,
      __metricsId,
      __hookId,
    }: {
      id: string;
      displayName: string;
      inputs?: BuildStepInput[];
      outputs?: BuildStepOutput[];
      command?: string;
      fn?: BuildStepFunction;
      workingDirectory?: string;
      shell?: string;
      supportedRuntimePlatforms?: BuildRuntimePlatform[];
      env?: BuildStepEnv;
      ifCondition?: string;
      compositeFunctionScope?: BuildStepCompositeFunctionScope;
      timeoutMs?: number;
      __metricsId?: string;
      __hookId?: HookAnchorId;
    }
  ) {
    assert(command !== undefined || fn !== undefined, 'Either command or fn must be defined.');
    assert(!(command !== undefined && fn !== undefined), 'Command and fn cannot be both set.');
    const outputById = makeBuildStepOutputByIdMap(outputs);
    super(id, displayName, false, outputById);

    this.id = id;
    this.displayName = displayName;
    this.supportedRuntimePlatforms = maybeSupportedRuntimePlatforms;
    this.inputs = inputs;
    this.inputById = makeBuildStepInputByIdMap(inputs);
    this.outputById = outputById;
    this.fn = fn;
    this.command = command;
    this.shell = shell ?? '/bin/bash -eo pipefail';
    this.ifCondition = ifCondition;
    this.compositeFunctionScope = compositeFunctionScope;
    this.timeoutMs = timeoutMs;
    this.__metricsId = __metricsId;
    this.__hookId = __hookId;
    this.status = BuildStepStatus.NEW;

    const logger = ctx.baseLogger.child({
      buildStepId: this.id,
      buildStepDisplayName: this.displayName,
    });
    this.ctx = ctx.stepCtx({ logger, relativeWorkingDirectory: maybeWorkingDirectory });
    this.stepEnvOverrides = env ?? {};

    this.outputsDir = getTemporaryOutputsDirPath(ctx, this.id);
    this.envsDir = getTemporaryEnvsDirPath(ctx, this.id);

    this.registerSelf(ctx);
  }

  /**
   * Consulted by registerSelf() in the constructor; overrides may only read state
   * assigned before that call (outputById, compositeFunctionScope).
   */
  public get isCompositeFunctionInternal(): boolean {
    return this.compositeFunctionScope !== undefined;
  }

  protected registerSelf(ctx: BuildStepGlobalContext): void {
    ctx.registerStep(this);
  }

  public async executeAsync(): Promise<void> {
    try {
      this.resolveTemplatedWorkingDirectoryIfNeeded();

      this.logStepStart();
      this.status = BuildStepStatus.IN_PROGRESS;

      await fs.mkdir(this.outputsDir, { recursive: true });
      this.ctx.logger.debug(`Created temporary directory for step outputs: ${this.outputsDir}`);

      await fs.mkdir(this.envsDir, { recursive: true });
      this.ctx.logger.debug(
        `Created temporary directory for step environment variables: ${this.envsDir}`
      );

      if (this.timeoutMs !== undefined) {
        const abortController = new AbortController();

        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => {
            // Reject with timeout error FIRST, before killing the process
            // This ensures the timeout error wins the race
            reject(
              new BuildStepRuntimeError(
                `Build step "${this.displayName}" timed out after ${this.timeoutMs}ms`
              )
            );

            abortController.abort();
          }, this.timeoutMs);
        });

        try {
          await Promise.race([
            this.command !== undefined
              ? this.executeCommandAsync({ signal: abortController.signal })
              : this.executeFnAsync({ signal: abortController.signal }),
            timeoutPromise,
          ]);
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      } else {
        const executionPromise =
          this.command !== undefined
            ? this.executeCommandAsync({ signal: null })
            : this.executeFnAsync({ signal: null });
        await executionPromise;
      }

      this.logStepSuccess();
      this.status = BuildStepStatus.SUCCESS;
    } catch (err) {
      // Downstream error handling relies on real Errors; wrap non-Error
      // throwables here, at the only step-execution boundary.
      const error =
        err instanceof Error
          ? err
          : new BuildStepRuntimeError(
              `Build step "${this.displayName}" threw a non-Error value: ${util.inspect(err)}`
            );
      this.logStepFailed(error);
      this.status = BuildStepStatus.FAIL;
      throw error;
    } finally {
      this.executed = true;

      try {
        await this.collectAndValidateOutputsAsync(this.outputsDir);
        await this.collectAndUpdateEnvsAsync(this.envsDir);
        this.ctx.logger.debug('Finished collecting output parameters');
      } catch (error) {
        // If the step succeeded, we expect the outputs to be collected successfully.
        if (this.status === BuildStepStatus.SUCCESS) {
          // Rethrow so BuildWorkflow.recordFailure marks the global failure flag.
          throw error;
        }

        this.ctx.logger.debug({ err: error }, 'Failed to collect output parameters');
      }

      await cleanUpStepTemporaryDirectoriesAsync(this.ctx.global, this.id);
    }
  }

  public canBeRunOnRuntimePlatform(): boolean {
    return (
      !this.supportedRuntimePlatforms ||
      this.supportedRuntimePlatforms.includes(this.ctx.global.runtimePlatform)
    );
  }

  public shouldExecuteStep(): boolean {
    if (
      this.compositeFunctionScope &&
      !this.compositeFunctionScope.isActive(evaluateIfConditionExpression)
    ) {
      return false;
    }
    if (!this.ifCondition) {
      return !this.ctx.global.hasAnyPreviousStepFailed;
    }
    return this.evaluateIfCondition(this.ifCondition, {
      scope: this.compositeFunctionScope,
      env: this.getScriptEnv(),
      inputs: this.compositeFunctionScope ? {} : this.evaluateOwnStepInputs(),
    });
  }

  private evaluateOwnStepInputs(): Record<string, unknown> {
    return (
      this.inputs?.reduce(
        (acc, input) => {
          acc[input.id] = input.getValue({
            interpolationContext: this.getInterpolationContext(),
            skipLegacyOutputInterpolation: this.compositeFunctionScope !== undefined,
          });
          return acc;
        },
        {} as Record<string, unknown>
      ) ?? {}
    );
  }

  private evaluateIfCondition(
    ifCondition: string,
    {
      scope,
      env,
      inputs,
    }: {
      scope: BuildStepCompositeFunctionScope | undefined;
      env: BuildStepEnv;
      inputs: Record<string, unknown>;
    }
  ): boolean {
    const baseContext = this.ctx.global.getIfConditionContext({
      inputs,
      env,
    }) as JobInterpolationContext;
    // Overlay the scope last so `inputs`/`steps` come from the composite function while `eas.*` stays global.
    const context = scope ? scope.getScopedInterpolationContext(baseContext) : baseContext;
    return evaluateIfConditionExpression(ifCondition, context);
  }

  public skip(): void {
    this.status = BuildStepStatus.SKIPPED;
    this.logStepSkipped();
  }

  protected logStepStart(): void {
    this.ctx.logger.info(
      { marker: BuildStepLogMarker.START_STEP },
      `Executing build step "${this.displayName}"`
    );
  }

  protected logStepSuccess(): void {
    this.ctx.logger.info(
      { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.SUCCESS },
      `Finished build step "${this.displayName}" successfully`
    );
  }

  protected logStepFailed(error: Error): void {
    this.ctx.logger.error({ err: error });
    this.ctx.logger.error(
      { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.FAIL },
      `Build step "${this.displayName}" failed`
    );
  }

  protected logStepSkipped(): void {
    this.ctx.logger.info(
      { marker: BuildStepLogMarker.START_STEP },
      'Executing build step "${this.displayName}"'
    );
    this.ctx.logger.info(`Skipped build step "${this.displayName}"`);
    this.ctx.logger.info(
      { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.SKIPPED },
      `Skipped build step "${this.displayName}"`
    );
  }

  private getInterpolationContext(): JobInterpolationContext {
    const base: JobInterpolationContext = {
      ...this.ctx.global.getInterpolationContext(),
      env: this.getScriptEnv(),
    };
    return this.compositeFunctionScope?.getScopedInterpolationContext(base) ?? base;
  }

  private async executeCommandAsync({ signal }: { signal: AbortSignal | null }): Promise<void> {
    assert(this.command, 'Command must be defined.');

    const interpolatedCommand = interpolateJobContext({
      target: this.command,
      context: this.getInterpolationContext(),
    });

    const command = this.interpolateInputsOutputsAndGlobalContextInTemplate(
      `${interpolatedCommand}`,
      this.inputs
    );
    this.ctx.logger.debug(`Interpolated inputs in the command template`);

    const scriptPath = await saveScriptToTemporaryFileAsync(this.ctx.global, this.id, command);
    this.ctx.logger.debug(`Saved script to ${scriptPath}`);

    const { command: shellCommand, args } = getShellCommandAndArgs(this.shell, scriptPath);
    this.ctx.logger.debug(
      `Executing script: ${shellCommand}${args !== undefined ? ` ${args.join(' ')}` : ''}`
    );

    try {
      const workingDirectoryStat = await fs.stat(this.ctx.workingDirectory);
      if (!workingDirectoryStat.isDirectory()) {
        this.ctx.logger.error(
          `Working directory "${this.ctx.workingDirectory}" exists, but is not a directory`
        );
      }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.ctx.logger.error(
          { err },
          `Working directory "${this.ctx.workingDirectory}" does not exist`
        );
      } else {
        this.ctx.logger.error(
          { err },
          `Cannot access working directory "${this.ctx.workingDirectory}"`
        );
      }
    }

    await spawnAsync(shellCommand, args ?? [], {
      cwd: this.ctx.workingDirectory,
      logger: this.ctx.logger,
      env: this.getScriptEnv(),
      // stdin is /dev/null, std{out,err} are piped into logger.
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: signal ?? undefined,
    });
    this.ctx.logger.debug(`Script completed successfully`);
  }

  private async executeFnAsync({ signal }: { signal: AbortSignal | null }): Promise<void> {
    assert(this.fn, 'Function (fn) must be defined');

    await this.fn(this.ctx, {
      inputs: Object.fromEntries(
        Object.entries(this.inputById).map(([key, input]) => [
          key,
          {
            value: input.getValue({
              interpolationContext: this.getInterpolationContext(),
              skipLegacyOutputInterpolation: this.compositeFunctionScope !== undefined,
            }),
          },
        ])
      ),
      outputs: this.outputById,
      env: this.getScriptEnv(),
      signal: signal ?? undefined,
    });

    this.ctx.logger.debug(`Script completed successfully`);
  }

  private interpolateInputsOutputsAndGlobalContextInTemplate(
    template: string,
    inputs?: BuildStepInput[]
  ): string {
    // Composite functions support only `${{ }}`; a literal `${ steps.x.y }` reaching bash is the accepted
    // behavior, so skip legacy output interpolation for composite-function-scoped steps.
    const skipLegacyOutputInterpolation = this.compositeFunctionScope !== undefined;
    if (!inputs) {
      const interpolatedWithGlobalContext = this.ctx.global.interpolate(template);
      return skipLegacyOutputInterpolation
        ? interpolatedWithGlobalContext
        : interpolateWithOutputs(interpolatedWithGlobalContext, path =>
            this.getLegacyStepOutputValue(path)
          );
    }
    const vars = inputs.reduce(
      (acc, input) => {
        const value = input.getValue({
          interpolationContext: this.getInterpolationContext(),
          skipLegacyOutputInterpolation,
        });
        acc[input.id] =
          typeof value === 'object' ? JSON.stringify(value) : (value?.toString() ?? '');
        return acc;
      },
      {} as Record<string, string>
    );
    const interpolatedWithInputsAndGlobalContext = interpolateWithInputs(
      this.ctx.global.interpolate(template),
      vars
    );
    return skipLegacyOutputInterpolation
      ? interpolatedWithInputsAndGlobalContext
      : interpolateWithOutputs(interpolatedWithInputsAndGlobalContext, path =>
          this.getLegacyStepOutputValue(path)
        );
  }

  private getLegacyStepOutputValue(path: string): string {
    return this.ctx.global.getStepOutputValue(path) ?? '';
  }

  private async collectAndValidateOutputsAsync(outputsDir: string): Promise<void> {
    const files = await fs.readdir(outputsDir);

    for (const outputId of files) {
      if (!(outputId in this.outputById)) {
        const newOutput = new BuildStepOutput(this.ctx.global, {
          id: outputId,
          stepDisplayName: this.displayName,
          required: false,
        });
        this.outputById[outputId] = newOutput;
      }

      const file = path.join(outputsDir, outputId);
      const rawContents = await fs.readFile(file, 'utf-8');
      const decodedContents = Buffer.from(rawContents, 'base64').toString('utf-8');
      this.outputById[outputId].set(decodedContents);
    }

    const nonSetRequiredOutputIds: string[] = [];
    for (const output of Object.values(this.outputById)) {
      try {
        const value = output.value;
        this.ctx.logger.debug(`Output parameter "${output.id}" is set to "${value}"`);
      } catch (err) {
        this.ctx.logger.debug({ err }, `Getting value for output parameter "${output.id}" failed.`);
        nonSetRequiredOutputIds.push(output.id);
      }
    }
    if (nonSetRequiredOutputIds.length > 0) {
      const idsString = nonSetRequiredOutputIds.map(i => `"${i}"`).join(', ');
      throw new BuildStepRuntimeError(`Some required outputs have not been set: ${idsString}`, {
        metadata: { ids: nonSetRequiredOutputIds },
      });
    }
  }

  private async collectAndUpdateEnvsAsync(envsDir: string): Promise<void> {
    const filenames = await fs.readdir(envsDir);

    const entries = await Promise.all(
      filenames.map(async basename => {
        const rawContents = await fs.readFile(path.join(envsDir, basename), 'utf-8');
        const decodedContents = Buffer.from(rawContents, 'base64').toString('utf-8');
        return [basename, decodedContents];
      })
    );
    this.ctx.global.updateEnv({
      ...this.ctx.global.env,
      ...Object.fromEntries(entries),
    });
  }

  private getInterpolatedEnvOverrides(): BuildStepEnv {
    const ownOverrides = this.stepEnvOverrides;
    if (!this.compositeFunctionScope) {
      return ownOverrides;
    }
    // Use global env here to avoid recursing through getScriptEnv.
    const base: JobInterpolationContext = {
      ...this.ctx.global.getInterpolationContext(),
      env: this.ctx.global.env,
    };
    // Call-site env uses caller scope; step env uses action scope.
    const inheritedEnv = this.compositeFunctionScope.resolveInheritedEnv(base);
    const scoped = this.compositeFunctionScope.getScopedInterpolationContext(base);
    const ownEnv = Object.fromEntries(
      Object.entries(ownOverrides).map(([key, value]) => {
        if (typeof value !== 'string' || !containsUnresolvedTemplateReference(value)) {
          return [key, value];
        }
        return [key, stringifyInterpolatedResult(resolveInterpolatedTarget(value, scoped))];
      })
    );
    return { ...inheritedEnv, ...ownEnv };
  }

  private getScriptEnv(): Record<string, string> {
    const effectiveEnv = { ...this.ctx.global.env, ...this.getInterpolatedEnvOverrides() };
    const currentPath = effectiveEnv.PATH ?? process.env.PATH;
    const newPath = currentPath ? `${BIN_PATH}:${currentPath}` : BIN_PATH;
    return {
      ...effectiveEnv,
      __EXPO_STEPS_OUTPUTS_DIR: this.outputsDir,
      __EXPO_STEPS_ENVS_DIR: this.envsDir,
      __EXPO_STEPS_WORKING_DIRECTORY: this.ctx.workingDirectory,
      PATH: newPath,
    };
  }

  private resolveTemplatedWorkingDirectoryIfNeeded(): void {
    const scope = this.compositeFunctionScope;
    if (!scope) {
      return;
    }
    const relativeWorkingDirectory = this.ctx.relativeWorkingDirectory;
    if (
      relativeWorkingDirectory === undefined ||
      !containsUnresolvedTemplateReference(relativeWorkingDirectory)
    ) {
      return;
    }
    const context = scope.getScopedInterpolationContext({
      ...this.ctx.global.getInterpolationContext(),
      env: this.getScriptEnv(),
    });
    const resolved = resolveInterpolatedTarget(relativeWorkingDirectory, context);
    this.ctx.updateRelativeWorkingDirectory(stringifyOptionalInterpolatedResult(resolved));
  }
}
