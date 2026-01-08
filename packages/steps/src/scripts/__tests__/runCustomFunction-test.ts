import path from 'path';
import os from 'os';
import fs from 'fs/promises';

import { createContext } from 'this-file';
import { v4 as uuidv4 } from 'uuid';
import { jest } from '@jest/globals';

import { BuildStepInput, BuildStepInputValueTypeName } from '../../BuildStepInput.js';
import { BuildStepOutput } from '../../BuildStepOutput.js';
import { createStepContextMock } from '../../__tests__/utils/context.js';
import {
  cleanUpStepTemporaryDirectoriesAsync,
  getTemporaryEnvsDirPath,
  getTemporaryOutputsDirPath,
} from '../../BuildTemporaryFiles.js';
import { BIN_PATH } from '../../utils/shell/bin.js';
import { createCustomFunctionCall } from '../../utils/customFunction.js';
import { createMockLogger } from '../../__tests__/utils/logger.js';

describe('runCustomFunction', () => {
  test('can run custom function', async () => {
    const dirname = createContext().dirname;
    const projectSourceDirectory = path.join(os.tmpdir(), 'eas-build', uuidv4());
    await fs.mkdir(projectSourceDirectory, { recursive: true });
    const logger = createMockLogger();
    // return the same logger instance so we can expect calls on it later
    jest.spyOn(logger, 'child').mockImplementation(() => logger);
    const ctx = createStepContextMock({
      projectTargetDirectory: path.resolve(dirname, '../../__tests__/fixtures'),
      projectSourceDirectory,
      logger,
    });
    const outputs = {
      name: new BuildStepOutput(ctx.global, {
        id: 'name',
        stepDisplayName: 'test',
        required: true,
      }),
      num: new BuildStepOutput(ctx.global, {
        id: 'num',
        stepDisplayName: 'test',
        required: true,
      }),
      obj: new BuildStepOutput(ctx.global, {
        id: 'obj',
        stepDisplayName: 'test',
        required: true,
      }),
    };
    const inputs = {
      name: new BuildStepInput(ctx.global, {
        id: 'name',
        stepDisplayName: 'test',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      num: new BuildStepInput(ctx.global, {
        id: 'num',
        stepDisplayName: 'test',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      }),
      obj: new BuildStepInput(ctx.global, {
        id: 'obj',
        stepDisplayName: 'test',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    };
    inputs.name.set('foo');
    inputs.num.set(123);
    inputs.obj.set({ foo: 'bar' });

    try {
      const outputsDir = getTemporaryOutputsDirPath(ctx.global, 'test');
      const envsDir = getTemporaryEnvsDirPath(ctx.global, 'test');

      await fs.mkdir(outputsDir, { recursive: true });
      await fs.mkdir(envsDir, { recursive: true });

      const currentPath = process.env.PATH;
      const newPath = currentPath ? `${BIN_PATH}:${currentPath}` : BIN_PATH;
      const fn = createCustomFunctionCall(
        path.resolve(dirname, '../../__tests__/fixtures/my-custom-ts-function')
      );
      const promise = fn(ctx, {
        env: {
          __EXPO_STEPS_OUTPUTS_DIR: outputsDir,
          __EXPO_STEPS_ENVS_DIR: envsDir,
          __EXPO_STEPS_WORKING_DIRECTORY: ctx.workingDirectory,
          PATH: newPath,
        },
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([id, input]) => [
            id,
            {
              value: input.getValue({
                interpolationContext: ctx.global.getInterpolationContext(),
              }),
            },
          ])
        ),
        outputs,
      });
      await expect(promise).resolves.not.toThrow();
    } finally {
      await cleanUpStepTemporaryDirectoriesAsync(ctx.global, 'test');
    }

    expect(jest.mocked(logger.info)).toHaveBeenCalledWith('Hello, foo!}'); // that "}" is in fixture
    expect(jest.mocked(logger.info)).toHaveBeenCalledWith('Your number is 123');
    expect(jest.mocked(logger.info)).toHaveBeenCalledWith('Your object is {"foo":"bar"}');
  });
});
