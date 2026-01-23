import path from 'path';

import fs from 'fs-extra';

import { BuildStepFunction } from '../BuildStep';
import { BuildStepEnv } from '../BuildStepEnv';
import { SerializedBuildStepOutput } from '../BuildStepOutput';
import { SerializedBuildStepContext } from '../BuildStepContext';

import { spawnAsync } from './shell/spawn';

export const SCRIPTS_PATH = path.join(__dirname, '../../dist/scripts');

type SerializedBuildStepInput = { serializedValue: string | undefined };

export interface SerializedCustomBuildFunctionArguments {
  env: BuildStepEnv;
  inputs: Record<string, SerializedBuildStepInput>;
  outputs: Record<string, SerializedBuildStepOutput>;
  ctx: SerializedBuildStepContext;
}

export function serializeInputs(
  inputs: Parameters<BuildStepFunction>[1]['inputs']
): SerializedCustomBuildFunctionArguments['inputs'] {
  return Object.fromEntries(
    Object.entries(inputs).map(([id, input]) => [
      id,
      { serializedValue: input === undefined ? undefined : JSON.stringify(input.value) },
    ])
  );
}

export function deserializeInputs(
  inputs: SerializedCustomBuildFunctionArguments['inputs']
): Parameters<BuildStepFunction>[1]['inputs'] {
  return Object.fromEntries(
    Object.entries(inputs).map(([id, { serializedValue }]) => [
      id,
      { value: serializedValue === undefined ? undefined : JSON.parse(serializedValue) },
    ])
  );
}

export function createCustomFunctionCall(rawCustomFunctionModulePath: string): BuildStepFunction {
  return async (ctx, { env, inputs, outputs }) => {
    let customFunctionModulePath = rawCustomFunctionModulePath;
    if (!(await fs.exists(ctx.global.projectSourceDirectory))) {
      const relative = path.relative(
        path.resolve(ctx.global.projectSourceDirectory),
        customFunctionModulePath
      );
      customFunctionModulePath = path.resolve(
        path.join(ctx.global.projectTargetDirectory, relative)
      );
    }
    const serializedArguments: SerializedCustomBuildFunctionArguments = {
      env,
      inputs: serializeInputs(inputs),
      outputs: Object.fromEntries(
        Object.entries(outputs).map(([id, output]) => [id, output.serialize()])
      ),
      ctx: ctx.serialize(),
    };
    try {
      await spawnAsync(
        'node',
        [
          path.join(SCRIPTS_PATH, 'runCustomFunction.js'),
          customFunctionModulePath,
          JSON.stringify(serializedArguments),
        ],
        {
          logger: ctx.logger,
          cwd: ctx.workingDirectory,
          env,
          stdio: 'pipe',
        }
      );
    } catch {
      throw new Error(`Custom function exited with non-zero exit code.`);
    }
  };
}
