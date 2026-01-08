import assert from 'assert';

import { createLogger } from '@expo/logger';
import { SpawnPromise, SpawnResult } from '@expo/spawn-async';
import cloneDeep from 'lodash.clonedeep';

import { BuildStepOutput } from '../BuildStepOutput.js';
import {
  SerializedCustomBuildFunctionArguments,
  deserializeInputs,
} from '../utils/customFunction.js';
import { BuildStepContext } from '../BuildStepContext.js';
import { BuildStepFunction } from '../BuildStep.js';
import { spawnAsync } from '../utils/shell/spawn.js';

async function runCustomJsFunctionAsync(): Promise<void> {
  const customJavascriptFunctionModulePath = process.argv[2];
  const functionArgs = process.argv[3];

  assert(customJavascriptFunctionModulePath, 'customJavascriptFunctionModulePath is required');
  assert(functionArgs, 'serializedFunctionParams is required');

  let serializedFunctionArguments: SerializedCustomBuildFunctionArguments;
  try {
    serializedFunctionArguments = JSON.parse(functionArgs);
  } catch (e) {
    console.error('Failed to parse serializedFunctionParams');
    throw e;
  }

  const logger = createLogger({
    name: 'customFunctionLogger',
    streams: [
      {
        type: 'raw',
        stream: {
          write: (rec: any) => {
            if (rec) {
              switch (rec.level) {
                case 20: // Debug level
                  if (rec.msg) {
                    console.debug(rec.msg);
                  }
                  break;
                case 30: // Info level
                  if (rec.msg) {
                    console.log(rec.msg);
                  }
                  break;
                case 40: // Warn level
                  if (rec.msg) {
                    console.warn(rec.msg);
                  }
                  break;
                case 50: // Error level
                case 60: // Fatal level
                  if (rec.msg) {
                    console.error(rec.msg);
                  }
                  break;
                default:
                  break;
              }
            }
          },
        },
      },
    ],
  });

  const ctx = BuildStepContext.deserialize(serializedFunctionArguments.ctx, logger);
  const inputs = deserializeInputs(serializedFunctionArguments.inputs);
  const outputs = Object.fromEntries(
    Object.entries(serializedFunctionArguments.outputs).map(([id, output]) => [
      id,
      BuildStepOutput.deserialize(output),
    ])
  );
  const env = serializedFunctionArguments.env;
  const envBefore = cloneDeep(serializedFunctionArguments.env);

  let customModule: { default: BuildStepFunction };
  try {
    customModule = await require(customJavascriptFunctionModulePath);
  } catch (e) {
    console.error('Failed to load custom function module');
    throw e;
  }

  const customJavascriptFunction = customModule.default;

  await customJavascriptFunction(ctx, { inputs, outputs, env });

  const promises: SpawnPromise<SpawnResult>[] = [];
  for (const output of Object.values(outputs)) {
    if (output.rawValue) {
      assert(output.value, 'output.value is required');
      promises.push(
        spawnAsync('set-output', [output.id, output.value], {
          env,
          stdio: 'pipe',
        })
      );
    }
  }
  for (const envName of Object.keys(env)) {
    const envValue = env[envName];
    if (envValue !== envBefore[envName] && envValue) {
      promises.push(
        spawnAsync('set-env', [envName, envValue], {
          env,
          stdio: 'pipe',
        })
      );
    }
  }
  await Promise.all(promises);
}

void runCustomJsFunctionAsync();
