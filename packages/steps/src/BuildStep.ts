import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import { Buffer } from 'buffer';

import { v4 as uuidv4 } from 'uuid';
import { JobInterpolationContext } from '@expo/eas-build-job';

import { BuildStepContext, BuildStepGlobalContext } from './BuildStepContext.js';
import { BuildStepInput, BuildStepInputById, makeBuildStepInputByIdMap } from './BuildStepInput.js';
import {
  BuildStepOutput,
  BuildStepOutputById,
  SerializedBuildStepOutput,
  makeBuildStepOutputByIdMap,
} from './BuildStepOutput.js';
import { BIN_PATH } from './utils/shell/bin.js';
import { getShellCommandAndArgs } from './utils/shell/command.js';
import {
  cleanUpStepTemporaryDirectoriesAsync,
  getTemporaryEnvsDirPath,
  getTemporaryOutputsDirPath,
  saveScriptToTemporaryFileAsync,
} from './BuildTemporaryFiles.js';
import { spawnAsync } from './utils/shell/spawn.js';
import { interpolateWithInputs, interpolateWithOutputs } from './utils/template.js';
import { BuildStepRuntimeError } from './errors.js';
import { BuildStepEnv } from './BuildStepEnv.js';
import { BuildRuntimePlatform } from './BuildRuntimePlatform.js';
import { jsepEval } from './utils/jsepEval.js';
import { interpolateJobContext } from './interpolation.js';

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

// TODO: move to a place common with tests
const UUID_REGEX =
  /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/;

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
  public readonly id: string;
  public readonly name?: string;
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
  public readonly timeoutMs?: number;
  public status: BuildStepStatus;
  private readonly outputsDir: string;
  private readonly envsDir: string;

  private readonly internalId: string;
  private readonly inputById: BuildStepInputById;
  protected executed = false;

  public static getNewId(userDefinedId?: string): string {
    return userDefinedId ?? uuidv4();
  }

  public static getDisplayName({
    id,
    name,
    command,
  }: {
    id: string;
    name?: string;
    command?: string;
  }): string {
    if (name) {
      return name;
    }
    if (!id.match(UUID_REGEX)) {
      return id;
    }
    if (command) {
      const splits = command.trim().split('\n');
      for (const split of splits) {
        const trimmed = split.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          return trimmed;
        }
      }
    }
    return id;
  }

  constructor(
    ctx: BuildStepGlobalContext,
    {
      id,
      name,
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
      timeoutMs,
    }: {
      id: string;
      name?: string;
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
      timeoutMs?: number;
    }
  ) {
    assert(command !== undefined || fn !== undefined, 'Either command or fn must be defined.');
    assert(!(command !== undefined && fn !== undefined), 'Command and fn cannot be both set.');
    const outputById = makeBuildStepOutputByIdMap(outputs);
    super(id, displayName, false, outputById);

    this.id = id;
    this.name = name;
    this.displayName = displayName;
    this.supportedRuntimePlatforms = maybeSupportedRuntimePlatforms;
    this.inputs = inputs;
    this.inputById = makeBuildStepInputByIdMap(inputs);
    this.outputById = outputById;
    this.fn = fn;
    this.command = command;
    this.shell = shell ?? '/bin/bash -eo pipefail';
    this.ifCondition = ifCondition;
    this.timeoutMs = timeoutMs;
    this.status = BuildStepStatus.NEW;

    this.internalId = uuidv4();

    const logger = ctx.baseLogger.child({
      buildStepInternalId: this.internalId,
      buildStepId: this.id,
      buildStepDisplayName: this.displayName,
    });
    this.ctx = ctx.stepCtx({ logger, relativeWorkingDirectory: maybeWorkingDirectory });
    this.stepEnvOverrides = env ?? {};

    this.outputsDir = getTemporaryOutputsDirPath(ctx, this.id);
    this.envsDir = getTemporaryEnvsDirPath(ctx, this.id);

    ctx.registerStep(this);
  }

  public async executeAsync(): Promise<void> {
    try {
      this.ctx.logger.info(
        { marker: BuildStepLogMarker.START_STEP },
        `Executing build step "${this.displayName}"`
      );
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

      this.ctx.logger.info(
        { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.SUCCESS },
        `Finished build step "${this.displayName}" successfully`
      );
      this.status = BuildStepStatus.SUCCESS;
    } catch (err) {
      this.ctx.logger.error({ err });
      this.ctx.logger.error(
        { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.FAIL },
        `Build step "${this.displayName}" failed`
      );
      this.status = BuildStepStatus.FAIL;
      throw err;
    } finally {
      this.executed = true;

      try {
        await this.collectAndValidateOutputsAsync(this.outputsDir);
        await this.collectAndUpdateEnvsAsync(this.envsDir);
        this.ctx.logger.debug('Finished collecting output parameters');
      } catch (error) {
        // If the step succeeded, we expect the outputs to be collected successfully.
        if (this.status === BuildStepStatus.SUCCESS) {
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
    const hasAnyPreviousStepFailed = this.ctx.global.hasAnyPreviousStepFailed;

    if (!this.ifCondition) {
      return !hasAnyPreviousStepFailed;
    }

    let ifCondition = this.ifCondition;

    if (ifCondition.startsWith('${{') && ifCondition.endsWith('}}')) {
      ifCondition = ifCondition.slice(3, -2);
    } else if (ifCondition.startsWith('${') && ifCondition.endsWith('}')) {
      ifCondition = ifCondition.slice(2, -1);
    }

    return Boolean(
      jsepEval(ifCondition, {
        inputs:
          this.inputs?.reduce(
            (acc, input) => {
              acc[input.id] = input.getValue({
                interpolationContext: this.getInterpolationContext(),
              });
              return acc;
            },
            {} as Record<string, unknown>
          ) ?? {},
        eas: {
          runtimePlatform: this.ctx.global.runtimePlatform,
          ...this.ctx.global.staticContext,
          env: this.getScriptEnv(),
        },
        ...this.getInterpolationContext(),
      })
    );
  }

  public skip(): void {
    this.status = BuildStepStatus.SKIPPED;
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
    return {
      ...this.ctx.global.getInterpolationContext(),
      env: this.getScriptEnv(),
    };
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
          { value: input.getValue({ interpolationContext: this.getInterpolationContext() }) },
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
    if (!inputs) {
      return interpolateWithOutputs(
        this.ctx.global.interpolate(template),
        (path) => this.ctx.global.getStepOutputValue(path) ?? ''
      );
    }
    const vars = inputs.reduce(
      (acc, input) => {
        const value = input.getValue({ interpolationContext: this.getInterpolationContext() });
        acc[input.id] = typeof value === 'object' ? JSON.stringify(value) : value?.toString() ?? '';
        return acc;
      },
      {} as Record<string, string>
    );
    return interpolateWithOutputs(
      interpolateWithInputs(this.ctx.global.interpolate(template), vars),
      (path) => this.ctx.global.getStepOutputValue(path) ?? ''
    );
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
      const idsString = nonSetRequiredOutputIds.map((i) => `"${i}"`).join(', ');
      throw new BuildStepRuntimeError(`Some required outputs have not been set: ${idsString}`, {
        metadata: { ids: nonSetRequiredOutputIds },
      });
    }
  }

  private async collectAndUpdateEnvsAsync(envsDir: string): Promise<void> {
    const filenames = await fs.readdir(envsDir);

    const entries = await Promise.all(
      filenames.map(async (basename) => {
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

  private getScriptEnv(): Record<string, string> {
    const effectiveEnv = { ...this.ctx.global.env, ...this.stepEnvOverrides };
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
}
