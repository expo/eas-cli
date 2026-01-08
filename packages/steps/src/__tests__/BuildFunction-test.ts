import { BuildFunction } from '../BuildFunction.js';
import { BuildStep, BuildStepFunction } from '../BuildStep.js';
import {
  BuildStepInput,
  BuildStepInputProvider,
  BuildStepInputValueTypeName,
} from '../BuildStepInput.js';
import { BuildStepOutput, BuildStepOutputProvider } from '../BuildStepOutput.js';

import { createGlobalContextMock } from './utils/context.js';
import { UUID_REGEX } from './utils/uuid.js';

describe(BuildFunction, () => {
  describe('constructor', () => {
    it('throws when command fn and customFunctionModulePath is not set', () => {
      expect(() => {
        // eslint-disable-next-line no-new
        new BuildFunction({
          id: 'test1',
        });
      }).toThrowError(/Either command, fn or path must be defined/);
    });

    it('throws when command and fn are both set', () => {
      expect(() => {
        // eslint-disable-next-line no-new
        new BuildFunction({
          id: 'test1',
          command: 'echo 123',
          fn: () => {},
        });
      }).toThrowError(/Command and fn cannot be both set/);
    });

    it('throws when command and customFunctionModulePath are both set', () => {
      expect(() => {
        // eslint-disable-next-line no-new
        new BuildFunction({
          id: 'test1',
          command: 'echo 123',
          customFunctionModulePath: 'test',
        });
      }).toThrowError(/Command and path cannot be both set/);
    });

    it('throws when fn and customFunctionModulePath are both set', () => {
      expect(() => {
        // eslint-disable-next-line no-new
        new BuildFunction({
          id: 'test1',
          fn: () => {},
          customFunctionModulePath: 'test',
        });
      }).toThrowError(/Fn and path cannot be both set/);
    });
  });

  describe(BuildFunction.prototype.getFullId, () => {
    test('namespace is not defined', () => {
      const buildFunction = new BuildFunction({
        id: 'upload_artifacts',
        name: 'Test function',
        command: 'echo 123',
      });
      expect(buildFunction.getFullId()).toBe('upload_artifacts');
    });
    test('namespace is defined', () => {
      const buildFunction = new BuildFunction({
        namespace: 'eas',
        id: 'upload_artifacts',
        name: 'Test function',
        command: 'echo 123',
      });
      expect(buildFunction.getFullId()).toBe('eas/upload_artifacts');
    });
  });

  describe(BuildFunction.prototype.createBuildStepFromFunctionCall, () => {
    it('returns a BuildStep object', () => {
      const ctx = createGlobalContextMock();
      const func = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        command: 'echo 123',
      });
      const step = func.createBuildStepFromFunctionCall(ctx, {
        workingDirectory: ctx.defaultWorkingDirectory,
      });
      expect(step).toBeInstanceOf(BuildStep);
      expect(step.id).toMatch(UUID_REGEX);
      expect(step.name).toBe('Test function');
      expect(step.command).toBe('echo 123');
    });
    it('works with build step function', () => {
      const ctx = createGlobalContextMock();
      const fn: BuildStepFunction = () => {};
      const buildFunction = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        fn,
      });
      const step = buildFunction.createBuildStepFromFunctionCall(ctx, {
        workingDirectory: ctx.defaultWorkingDirectory,
      });
      expect(step).toBeInstanceOf(BuildStep);
      expect(step.id).toMatch(UUID_REGEX);
      expect(step.name).toBe('Test function');
      expect(step.fn).toBe(fn);
    });
    it('works with custom JS/TS function', () => {
      const ctx = createGlobalContextMock();
      const buildFunction = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        customFunctionModulePath: './customFunctionTest',
      });
      const step = buildFunction.createBuildStepFromFunctionCall(ctx, {
        workingDirectory: ctx.defaultWorkingDirectory,
      });
      expect(step).toBeInstanceOf(BuildStep);
      expect(step.id).toMatch(UUID_REGEX);
      expect(step.name).toBe('Test function');
      expect(step.fn).toEqual(expect.any(Function));
    });
    it('can override id and shell from function definition', () => {
      const ctx = createGlobalContextMock();
      const func = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        command: 'echo 123',
        shell: '/bin/bash',
      });
      const step = func.createBuildStepFromFunctionCall(ctx, {
        id: 'test2',
        shell: '/bin/zsh',
        workingDirectory: ctx.defaultWorkingDirectory,
      });
      expect(func.id).toBe('test1');
      expect(func.shell).toBe('/bin/bash');
      expect(step.id).toBe('test2');
      expect(step.shell).toBe('/bin/zsh');
    });
    it('creates function inputs and outputs', () => {
      const ctx = createGlobalContextMock();
      const inputProviders: BuildStepInputProvider[] = [
        BuildStepInput.createProvider({
          id: 'input1',
          defaultValue: true,
          allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'input2',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
        BuildStepInput.createProvider({
          id: 'input3',
          defaultValue: 1,
          allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'input4',
          defaultValue: { a: 1 },
          allowedValueTypeName: BuildStepInputValueTypeName.JSON,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'input5',
          defaultValue: '${ eas.job.version.buildNumber }',
          allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
          required: true,
        }),
      ];
      const outputProviders: BuildStepOutputProvider[] = [
        BuildStepOutput.createProvider({ id: 'output1', required: true }),
        BuildStepOutput.createProvider({ id: 'output2', required: true }),
      ];
      const func = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        command:
          'echo ${ inputs.input1 } ${ inputs.input2 }\nset-output output1 value1\nset-output output2 value2',
        inputProviders,
        outputProviders,
      });
      const step = func.createBuildStepFromFunctionCall(ctx, {
        callInputs: {
          input1: true,
          input2: 'def',
        },
        workingDirectory: ctx.defaultWorkingDirectory,
      });
      expect(func.inputProviders?.[0]).toBe(inputProviders[0]);
      expect(func.inputProviders?.[1]).toBe(inputProviders[1]);
      expect(func.inputProviders?.[2]).toBe(inputProviders[2]);
      expect(func.inputProviders?.[3]).toBe(inputProviders[3]);
      expect(func.outputProviders?.[0]).toBe(outputProviders[0]);
      expect(func.outputProviders?.[1]).toBe(outputProviders[1]);
      expect(step.inputs?.[0].id).toBe('input1');
      expect(step.inputs?.[1].id).toBe('input2');
      expect(step.inputs?.[2].id).toBe('input3');
      expect(step.outputById.output1).toBeDefined();
      expect(step.outputById.output2).toBeDefined();
    });
    it('passes values to build inputs', () => {
      const ctx = createGlobalContextMock();
      const inputProviders: BuildStepInputProvider[] = [
        BuildStepInput.createProvider({
          id: 'input1',
          defaultValue: 'xyz1',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
        BuildStepInput.createProvider({
          id: 'input2',
          defaultValue: 'xyz2',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
        BuildStepInput.createProvider({
          id: 'input3',
          defaultValue: true,
          allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'input4',
          defaultValue: {
            a: 1,
          },
          allowedValueTypeName: BuildStepInputValueTypeName.JSON,
          required: true,
        }),
      ];
      const func = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        command: 'echo ${ inputs.input1 } ${ inputs.input2 }',
        inputProviders,
      });
      const step = func.createBuildStepFromFunctionCall(ctx, {
        id: 'buildStep1',
        callInputs: {
          input1: 'abc',
          input2: 'def',
          input3: false,
          input4: {
            b: 2,
          },
        },
        workingDirectory: ctx.defaultWorkingDirectory,
      });
      expect(
        step.inputs?.[0].getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toBe('abc');
      expect(
        step.inputs?.[1].getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toBe('def');
      expect(
        step.inputs?.[2].getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toBe(false);
      expect(
        step.inputs?.[3].getValue({
          interpolationContext: ctx.getInterpolationContext(),
        })
      ).toMatchObject({
        b: 2,
      });
    });
    it('passes env to build step', () => {
      const ctx = createGlobalContextMock();
      const func = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        command: 'echo ${ inputs.input1 } ${ inputs.input2 }',
      });
      const step = func.createBuildStepFromFunctionCall(ctx, {
        id: 'buildStep1',
        workingDirectory: ctx.defaultWorkingDirectory,
        env: {
          ENV1: 'env1',
          ENV2: 'env2',
        },
      });
      expect(step.stepEnvOverrides).toMatchObject({
        ENV1: 'env1',
        ENV2: 'env2',
      });
    });
    it('passes ifCondition to build step', () => {
      const ctx = createGlobalContextMock();
      const func = new BuildFunction({
        id: 'test1',
        name: 'Test function',
        command: 'echo test',
      });
      const step = func.createBuildStepFromFunctionCall(ctx, {
        id: 'buildStep1',
        workingDirectory: ctx.defaultWorkingDirectory,
        ifCondition: '${ always() }',
      });
      expect(step.ifCondition).toBe('${ always() }');
    });
  });
});
