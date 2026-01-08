import path from 'path';
import assert from 'node:assert';

import { BuildFunction } from '../BuildFunction.js';
import { BuildFunctionGroup } from '../BuildFunctionGroup.js';
import { BuildWorkflow } from '../BuildWorkflow.js';
import { BuildConfigError, BuildStepRuntimeError } from '../errors.js';
import { StepsConfigParser } from '../StepsConfigParser.js';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput.js';

import { createGlobalContextMock } from './utils/context.js';
import { getError } from './utils/error.js';
import { UUID_REGEX } from './utils/uuid.js';

describe(StepsConfigParser, () => {
  describe('constructor', () => {
    it('throws if provided external functions with duplicated IDs', () => {
      const ctx = createGlobalContextMock();
      const error = getError<BuildStepRuntimeError>(() => {
        // eslint-disable-next-line no-new
        new StepsConfigParser(ctx, {
          steps: [],
          externalFunctions: [
            new BuildFunction({ id: 'abc', command: 'echo 123' }),
            new BuildFunction({ id: 'abc', command: 'echo 456' }),
          ],
        });
      });
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toMatch(/Provided external functions with duplicated IDs/);
    });

    it('throws if provided external function groups with duplicated IDs', () => {
      const ctx = createGlobalContextMock();
      const error = getError<BuildStepRuntimeError>(() => {
        // eslint-disable-next-line no-new
        new StepsConfigParser(ctx, {
          steps: [
            {
              run: 'test',
            },
            {
              uses: 'eas/build',
            },
          ],
          externalFunctionGroups: [
            new BuildFunctionGroup({
              id: 'abc',
              namespace: 'test',
              createBuildStepsFromFunctionGroupCall: () => [],
            }),
            new BuildFunctionGroup({
              id: 'abc',
              namespace: 'test',
              createBuildStepsFromFunctionGroupCall: () => [],
            }),
          ],
        });
      });
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toMatch(/Provided external function groups with duplicated IDs/);
    });

    it(`doesn't throw if provided external functions don't have duplicated IDs`, () => {
      const ctx = createGlobalContextMock();
      expect(() => {
        // eslint-disable-next-line no-new
        new StepsConfigParser(ctx, {
          steps: [
            {
              run: 'test',
            },
            {
              uses: 'eas/build',
            },
          ],
          externalFunctions: [
            new BuildFunction({ namespace: 'a', id: 'abc', command: 'echo 123' }),
            new BuildFunction({ namespace: 'b', id: 'abc', command: 'echo 456' }),
          ],
        });
      }).not.toThrow();
    });

    it(`doesn't throw if provided external function groups don't have duplicated IDs`, () => {
      const ctx = createGlobalContextMock();
      expect(() => {
        // eslint-disable-next-line no-new
        new StepsConfigParser(ctx, {
          steps: [
            {
              run: 'test',
            },
            {
              uses: 'eas/build',
            },
          ],
          externalFunctionGroups: [
            new BuildFunctionGroup({
              id: 'abc',
              namespace: 'test',
              createBuildStepsFromFunctionGroupCall: () => [],
            }),
            new BuildFunctionGroup({
              id: 'abcd',
              namespace: 'test',
              createBuildStepsFromFunctionGroupCall: () => [],
            }),
          ],
        });
      }).not.toThrow();
    });
  });

  describe(StepsConfigParser.prototype.parseAsync, () => {
    it('throws an error when calling non-existent function', async () => {
      const ctx = createGlobalContextMock();
      const parser = new StepsConfigParser(ctx, {
        steps: [
          {
            run: 'test',
          },
          {
            uses: 'eas/build',
          },
        ],
      });
      await expect(parser.parseAsync()).rejects.toThrow(
        'Calling non-existent functions: "eas/build".'
      );
    });

    it('throws an error if steps are empty array', async () => {
      const ctx = createGlobalContextMock();
      const parser = new StepsConfigParser(ctx, {
        steps: [],
      });
      await expect(parser.parseAsync()).rejects.toThrow(
        'Too small: expected array to have >=1 items'
      );
    });

    it('returns a BuildWorkflow object', async () => {
      const ctx = createGlobalContextMock();
      const parser = new StepsConfigParser(ctx, {
        steps: [
          {
            run: 'test',
          },
          {
            uses: 'eas/build',
          },
        ],
        externalFunctionGroups: [
          new BuildFunctionGroup({
            id: 'build',
            namespace: 'eas',
            createBuildStepsFromFunctionGroupCall: () => [],
          }),
        ],
      });
      const result = await parser.parseAsync();
      expect(result).toBeInstanceOf(BuildWorkflow);
    });

    it('parses steps and external functions into build workflow with steps', async () => {
      const ctx = createGlobalContextMock();
      const parser = new StepsConfigParser(ctx, {
        steps: [
          {
            run: 'command1',
          },
          {
            uses: 'eas/build',
          },
          {
            id: 'step3',
            name: 'Step 3',
            run: 'command2',
            shell: 'sh',
            working_directory: 'dir',
            env: {
              KEY1: 'value1',
            },
            outputs: [
              {
                name: 'my_output',
                required: true,
              },
              {
                name: 'my_optional_output',
                required: false,
              },
              {
                name: 'my_optional_output_without_required',
              },
            ],
            if: '${ always() }',
          },
          {
            id: 'step4',
            name: 'Step 4',
            with: {
              arg1: 'value1',
              arg2: 2,
              arg3: {
                key1: 'value1',
                key2: ['value1'],
              },
              arg4: '${ step3.my_output }',
            },
            uses: 'eas/checkout',
            if: '${ ctx.job.platform } == "android"',
            working_directory: 'dir',
            env: {
              KEY2: 'value2',
            },
          },
        ],
        externalFunctionGroups: [
          new BuildFunctionGroup({
            id: 'build',
            namespace: 'eas',
            createBuildStepsFromFunctionGroupCall: () => [
              new BuildFunction({
                id: 'func',
                fn: () => {
                  console.log('step2');
                },
              }).createBuildStepFromFunctionCall(ctx, {
                id: 'step2',
                workingDirectory: 'test',
                env: {
                  a: 'b',
                },
              }),
            ],
          }),
        ],
        externalFunctions: [
          new BuildFunction({
            id: 'checkout',
            namespace: 'eas',
            fn: () => {
              console.log('checkout');
            },
            inputProviders: [
              BuildStepInput.createProvider({
                id: 'arg1',
                allowedValueTypeName: BuildStepInputValueTypeName.STRING,
                required: true,
              }),
              BuildStepInput.createProvider({
                id: 'arg2',
                allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
                required: true,
              }),
              BuildStepInput.createProvider({
                id: 'arg3',
                allowedValueTypeName: BuildStepInputValueTypeName.JSON,
                required: true,
              }),
              BuildStepInput.createProvider({
                id: 'arg4',
                allowedValueTypeName: BuildStepInputValueTypeName.STRING,
                required: true,
              }),
            ],
          }),
        ],
      });
      const result = await parser.parseAsync();
      expect(result.buildSteps).toHaveLength(4);

      const step1 = result.buildSteps[0];
      expect(step1.id).toMatch(UUID_REGEX);
      expect(step1.name).toBeUndefined();
      expect(step1.command).toBe('command1');
      expect(step1.shell).toBe('/bin/bash -eo pipefail');
      expect(step1.fn).toBeUndefined();
      expect(step1.ctx.workingDirectory).toBe(ctx.defaultWorkingDirectory);
      expect(step1.stepEnvOverrides).toEqual({});
      expect(step1.inputs).toBeUndefined();
      expect(step1.outputById).toStrictEqual({});
      expect(step1.ifCondition).toBeUndefined();

      const step2 = result.buildSteps[1];
      expect(step2.id).toEqual('step2');
      expect(step2.name).toBeUndefined();
      expect(step2.command).toBeUndefined();
      expect(step2.fn).toBeDefined();
      expect(step2.ctx.workingDirectory).toBe(path.join(ctx.defaultWorkingDirectory, 'test'));
      expect(step2.stepEnvOverrides).toMatchObject({
        a: 'b',
      });
      expect(step2.inputs).toBeUndefined();
      expect(step2.outputById).toStrictEqual({});
      expect(step2.ifCondition).toBeUndefined();

      const step3 = result.buildSteps[2];
      expect(step3.id).toEqual('step3');
      expect(step3.name).toEqual('Step 3');
      expect(step3.command).toBe('command2');
      expect(step3.shell).toBe('sh');
      expect(step3.fn).toBeUndefined();
      expect(step3.ctx.workingDirectory).toBe(path.join(ctx.defaultWorkingDirectory, 'dir'));
      expect(step3.stepEnvOverrides).toMatchObject({
        KEY1: 'value1',
      });
      expect(step3.inputs).toBeUndefined();
      expect(step3.outputById).toBeDefined();
      expect(Object.keys(step3.outputById)).toHaveLength(3);
      assert(step3.outputById);
      const {
        my_output: output1,
        my_optional_output: output2,
        my_optional_output_without_required: output3,
      } = step3.outputById;
      expect(output1.id).toBe('my_output');
      expect(output1.required).toBe(true);
      expect(output2.id).toBe('my_optional_output');
      expect(output2.required).toBe(false);
      expect(output3.id).toBe('my_optional_output_without_required');
      expect(output3.required).toBe(true);
      expect(step3.ifCondition).toBe('${ always() }');

      const step4 = result.buildSteps[3];
      expect(step4.id).toEqual('step4');
      expect(step4.name).toEqual('Step 4');
      expect(step4.command).toBeUndefined();
      expect(step4.fn).toBeDefined();
      expect(step4.ctx.workingDirectory).toBe(path.join(ctx.defaultWorkingDirectory, 'dir'));
      expect(step4.stepEnvOverrides).toMatchObject({
        KEY2: 'value2',
      });
      expect(step4.inputs).toBeDefined();
      assert(step4.inputs);
      const [input1, input2, input3, input4] = step4.inputs;
      expect(input1.id).toBe('arg1');
      expect(
        input1.getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toBe('value1');
      expect(input1.allowedValueTypeName).toBe(BuildStepInputValueTypeName.STRING);
      expect(input1.allowedValues).toBeUndefined();
      expect(input1.defaultValue).toBeUndefined();
      expect(input1.rawValue).toBe('value1');
      expect(input1.required).toBe(true);
      expect(input2.id).toBe('arg2');
      expect(
        input2.getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toBe(2);
      expect(input2.allowedValueTypeName).toBe(BuildStepInputValueTypeName.NUMBER);
      expect(input2.allowedValues).toBeUndefined();
      expect(input2.defaultValue).toBeUndefined();
      expect(input2.rawValue).toBe(2);
      expect(input2.required).toBe(true);
      expect(input3.id).toBe('arg3');
      expect(
        input3.getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toMatchObject({
        key1: 'value1',
        key2: ['value1'],
      });
      expect(input3.allowedValueTypeName).toBe(BuildStepInputValueTypeName.JSON);
      expect(input3.allowedValues).toBeUndefined();
      expect(input3.defaultValue).toBeUndefined();
      expect(input3.rawValue).toMatchObject({
        key1: 'value1',
        key2: ['value1'],
      });
      expect(input3.required).toBe(true);
      expect(input4.id).toBe('arg4');
      expect(input4.allowedValueTypeName).toBe(BuildStepInputValueTypeName.STRING);
      expect(input4.allowedValues).toBeUndefined();
      expect(input4.defaultValue).toBeUndefined();
      expect(input4.rawValue).toBe('${ step3.my_output }');
      expect(input4.required).toBe(true);
      expect(step4.outputById).toStrictEqual({});
      expect(step4.ifCondition).toBe('${ ctx.job.platform } == "android"');
    });
  });
});
