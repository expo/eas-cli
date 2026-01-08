import fs from 'fs/promises';
import path from 'path';

import { jest } from '@jest/globals';
import { instance, mock, verify, when } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { BuildStep, BuildStepFunction, BuildStepStatus } from '../BuildStep.js';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput.js';
import { BuildStepGlobalContext, BuildStepContext } from '../BuildStepContext.js';
import { BuildStepOutput } from '../BuildStepOutput.js';
import { BuildStepRuntimeError } from '../errors.js';
import { nullthrows } from '../utils/nullthrows.js';
import { BuildRuntimePlatform } from '../BuildRuntimePlatform.js';
import { spawnAsync } from '../utils/shell/spawn.js';
import { BuildStepEnv } from '../BuildStepEnv.js';
import { BuildFunction } from '../BuildFunction.js';

import { createGlobalContextMock } from './utils/context.js';
import { createMockLogger } from './utils/logger.js';
import { getError, getErrorAsync } from './utils/error.js';
import { UUID_REGEX } from './utils/uuid.js';

describe(BuildStep, () => {
  describe(BuildStep.getNewId, () => {
    it('returns a uuid if the user-defined id is undefined', () => {
      expect(BuildStep.getNewId()).toMatch(UUID_REGEX);
    });
    it('returns the user-defined id if defined', () => {
      expect(BuildStep.getNewId('test1')).toBe('test1');
    });
  });

  describe(BuildStep.getDisplayName, () => {
    it('returns the name if defined', () => {
      expect(BuildStep.getDisplayName({ id: 'test1', name: 'Step 1' })).toBe('Step 1');
    });
    it("returns the id if it's not a uuid", () => {
      expect(BuildStep.getDisplayName({ id: 'test1' })).toBe('test1');
    });
    it('returns the first line of the command if name is undefined and id is a uuid', () => {
      expect(BuildStep.getDisplayName({ id: uuidv4(), command: 'echo 123\necho 456' })).toBe(
        'echo 123'
      );
    });
    it('returns the first non-comment line of the command', async () => {
      expect(
        BuildStep.getDisplayName({ id: uuidv4(), command: '# list files\nls -la\necho 123' })
      ).toBe('ls -la');
    });
    it('returns the uuid id if neither name nor command is defined', () => {
      const id = uuidv4();
      expect(BuildStep.getDisplayName({ id })).toBe(id);
    });
  });

  describe('constructor', () => {
    it('throws when neither command nor fn is set', () => {
      const mockCtx = mock<BuildStepGlobalContext>();
      when(mockCtx.baseLogger).thenReturn(createMockLogger());
      const ctx = instance(mockCtx);
      expect(() => {
        const id = 'test1';
        // eslint-disable-next-line no-new
        new BuildStep(ctx, {
          id,
          displayName: BuildStep.getDisplayName({ id }),
          workingDirectory: '/tmp',
        });
      }).toThrowError(/Either command or fn must be defined/);
    });

    it('throws when neither command nor fn is set', () => {
      const mockCtx = mock<BuildStepGlobalContext>();
      when(mockCtx.baseLogger).thenReturn(createMockLogger());
      const ctx = instance(mockCtx);
      expect(() => {
        const id = 'test1';
        const command = 'echo 123';
        const displayName = BuildStep.getDisplayName({ id, command });

        // eslint-disable-next-line no-new
        new BuildStep(ctx, {
          id,
          displayName,
          workingDirectory: '/tmp',
          command,
          fn: () => {},
        });
      }).toThrowError(/Command and fn cannot be both set/);
    });

    it('calls ctx.registerStep with the new object', () => {
      const mockCtx = mock<BuildStepGlobalContext>();
      when(mockCtx.baseLogger).thenReturn(createMockLogger());
      when(mockCtx.stepsInternalBuildDirectory).thenReturn('temp-dir');
      const ctx = instance(mockCtx);

      const id = 'test1';
      const command = 'ls -la';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(ctx, {
        id,
        displayName,
        command,
        workingDirectory: '/tmp',
      });
      // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
      verify(mockCtx.registerStep(step)).called();
    });

    it('sets the status to NEW', () => {
      const ctx = createGlobalContextMock();

      const id = 'test1';
      const command = 'ls -la';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(ctx, {
        id,
        displayName,
        command,
        workingDirectory: '/tmp',
      });
      expect(step.status).toBe(BuildStepStatus.NEW);
    });

    it('creates child build context', () => {
      const ctx = createGlobalContextMock();

      const id = 'test1';
      const command = 'ls -la';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(ctx, {
        id,
        displayName,
        command,
      });
      expect(step.ctx).toBeInstanceOf(BuildStepContext);
      expect(step.ctx).not.toBe(ctx);
    });

    it('creates child build context with correct changed working directory', () => {
      const ctx = createGlobalContextMock({
        projectTargetDirectory: '/a/b',
        relativeWorkingDirectory: 'c',
      });
      ctx.markAsCheckedOut(ctx.baseLogger);

      const id = 'test1';
      const command = 'ls -la';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(ctx, {
        id,
        displayName,
        command,
        workingDirectory: 'd/e/f',
      });
      expect(step.ctx.workingDirectory).toBe('/a/b/c/d/e/f');
    });

    it('creates child build context with unchanged working directory', () => {
      const ctx = createGlobalContextMock({
        projectTargetDirectory: '/a/b',
        relativeWorkingDirectory: 'c',
      });
      ctx.markAsCheckedOut(ctx.baseLogger);

      const id = 'test1';
      const command = 'ls -la';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(ctx, {
        id,
        command,
        displayName,
      });
      expect(step.ctx.workingDirectory).toBe('/a/b/c');
    });

    it('creates child build context with child logger', () => {
      const ctx = createGlobalContextMock();

      const id = 'test1';
      const name = 'Test step';
      const command = 'ls -la';
      const displayName = BuildStep.getDisplayName({ id, name, command });

      const step = new BuildStep(ctx, {
        id,
        name,
        displayName,
        command,
      });
      expect(ctx.baseLogger.child).toHaveBeenCalledWith(
        expect.objectContaining({
          buildStepInternalId: expect.stringMatching(UUID_REGEX),
          buildStepId: 'test1',
          buildStepDisplayName: 'Test step',
        })
      );
      expect(step.ctx.logger).not.toBe(ctx.baseLogger);
    });
  });

  describe(BuildStep.prototype.executeAsync, () => {
    let baseStepCtx: BuildStepGlobalContext;

    beforeEach(async () => {
      baseStepCtx = createGlobalContextMock({
        runtimePlatform: BuildRuntimePlatform.LINUX,
      });
      await fs.mkdir(baseStepCtx.defaultWorkingDirectory, { recursive: true });
      await fs.mkdir(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
    });
    afterEach(async () => {
      await fs.rm(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
    });

    it('sets status to FAIL when step fails', async () => {
      const id = 'test1';
      const command = 'false';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(baseStepCtx, {
        id,
        command,
        displayName,
      });
      await expect(step.executeAsync()).rejects.toThrow();
      expect(step.status).toBe(BuildStepStatus.FAIL);
    });

    it('sets status to SUCCESS when step succeeds', async () => {
      const id = 'test1';
      const command = 'true';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        command,
      });
      await step.executeAsync();
      expect(step.status).toBe(BuildStepStatus.SUCCESS);
    });

    describe('command', () => {
      it('logs an error if the command is to be executed in non-existing working directory', async () => {
        const id = 'test1';
        const command = 'ls -la';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          command,
          displayName,
          workingDirectory: 'non-existing-directory',
        });

        let err;
        try {
          await step.executeAsync();
        } catch (error) {
          err = error;
        }

        expect(err).toBeDefined();
        expect(step.ctx.logger.error).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining(
            `Working directory "${path.join(baseStepCtx.defaultWorkingDirectory, 'non-existing-directory')}" does not exist`
          )
        );
      });

      it('does not log an error if the command is to be executed in a directory that exists', async () => {
        const id = 'test1';
        const command = 'ls -la';
        const displayName = BuildStep.getDisplayName({ id, command });

        await fs.mkdir(path.join(baseStepCtx.defaultWorkingDirectory, 'existing-directory'), {
          recursive: true,
        });

        const step = new BuildStep(baseStepCtx, {
          id,
          command,
          displayName,
          workingDirectory: 'existing-directory',
        });

        let err;
        try {
          await step.executeAsync();
        } catch (error) {
          err = error;
        }

        expect(err).toBeUndefined();
        expect(step.ctx.logger.error).not.toHaveBeenCalled();
      });

      it('executes the command passed to the step', async () => {
        const logger = createMockLogger();
        const lines: string[] = [];
        jest
          .mocked(logger.info as any)
          .mockImplementation((obj: object | string, line?: string) => {
            if (typeof obj === 'string') {
              lines.push(obj);
            } else if (line) {
              lines.push(line);
            }
          });
        jest.mocked(logger.child).mockReturnValue(logger);
        (baseStepCtx as any).baseLogger = logger;

        await Promise.all([
          fs.writeFile(
            path.join(baseStepCtx.defaultWorkingDirectory, 'expo-abc123'),
            'lorem ipsum'
          ),
          fs.writeFile(
            path.join(baseStepCtx.defaultWorkingDirectory, 'expo-def456'),
            'lorem ipsum'
          ),
          fs.writeFile(
            path.join(baseStepCtx.defaultWorkingDirectory, 'expo-ghi789'),
            'lorem ipsum'
          ),
        ]);

        const id = 'test1';
        const command = 'ls -la';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          command,
          displayName,
        });
        await step.executeAsync();

        expect(lines.find((line) => line.match('expo-abc123'))).toBeTruthy();
        expect(lines.find((line) => line.match('expo-def456'))).toBeTruthy();
        expect(lines.find((line) => line.match('expo-ghi789'))).toBeTruthy();
      });

      it('interpolates the inputs in command template', async () => {
        const id = 'test1';
        const command = "set-output foo2 '${inputs.foo1}  ${inputs.foo2} ${inputs.foo3}'";
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          inputs: [
            new BuildStepInput(baseStepCtx, {
              id: 'foo1',
              stepDisplayName: displayName,
              defaultValue: 'bar',
              required: true,
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
            new BuildStepInput(baseStepCtx, {
              id: 'foo2',
              stepDisplayName: displayName,
              defaultValue: '${ eas.runtimePlatform }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
              required: true,
            }),
            new BuildStepInput(baseStepCtx, {
              id: 'foo3',
              stepDisplayName: displayName,
              defaultValue: {
                foo: 'bar',
                baz: [1, 'aaa'],
              },
              allowedValueTypeName: BuildStepInputValueTypeName.JSON,
              required: true,
            }),
          ],
          outputs: [
            new BuildStepOutput(baseStepCtx, {
              id: 'foo2',
              stepDisplayName: displayName,
              required: true,
            }),
          ],
          command,
        });
        await step.executeAsync();
        expect(step.getOutputValueByName('foo2')).toBe('bar  linux {"foo":"bar","baz":[1,"aaa"]}');
      });

      it('interpolates the outputs in command template', async () => {
        const stepWithOutput = new BuildFunction({
          id: 'func',
          fn: (_ctx, { outputs }) => {
            outputs.foo.set('bar');
          },
          outputProviders: [
            BuildStepOutput.createProvider({
              id: 'foo',
              required: true,
            }),
          ],
        }).createBuildStepFromFunctionCall(baseStepCtx, {
          id: 'step1',
        });
        await stepWithOutput.executeAsync();
        expect(stepWithOutput.getOutputValueByName('foo')).toBe('bar');

        const step = new BuildStep(baseStepCtx, {
          id: 'step2',
          command: "set-output foo2 '${ steps.step1.foo }'",
          displayName: 'Step 2',
          outputs: [
            new BuildStepOutput(baseStepCtx, {
              id: 'foo2',
              stepDisplayName: 'Step 2',
              required: true,
            }),
          ],
        });
        await step.executeAsync();
        expect(step.getOutputValueByName('foo2')).toBe('bar');
      });

      it('collects the outputs after calling the script', async () => {
        const id = 'test1';
        const command = 'set-output abc 123';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          outputs: [
            new BuildStepOutput(baseStepCtx, {
              id: 'abc',
              stepDisplayName: displayName,
              required: true,
            }),
          ],
          command,
        });
        await step.executeAsync();
        const abc = nullthrows(step.outputById.abc);
        expect(abc?.value).toBe('123');
      });

      it('collects the envs after calling the fn', async () => {
        const id = 'test1';
        const fn = jest.fn(async (ctx: BuildStepContext, { env }: { env: BuildStepEnv }) => {
          await spawnAsync('set-env', ['ABC', '123'], {
            cwd: ctx.workingDirectory,
            env,
          });
        });
        const displayName = BuildStep.getDisplayName({ id });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          fn,
        });
        await step.executeAsync();
        expect(baseStepCtx.env).toMatchObject({ ABC: '123' });
      });

      it('collects the outputs after calling the fn', async () => {
        const id = 'test1';
        const fn = jest.fn(async (ctx: BuildStepContext, { env }: { env: BuildStepEnv }) => {
          await spawnAsync('set-output', ['abc', '123'], {
            cwd: ctx.workingDirectory,
            env,
          });
        });
        const displayName = BuildStep.getDisplayName({ id });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          outputs: [
            new BuildStepOutput(baseStepCtx, {
              id: 'abc',
              stepDisplayName: displayName,
              required: true,
            }),
          ],
          fn,
        });
        await step.executeAsync();
        const abc = nullthrows(step.outputById.abc);
        expect(abc?.value).toBe('123');
      });
    });

    describe('timeout', () => {
      it('succeeds when step completes within timeout', async () => {
        const id = 'test1';
        const command = 'sleep 0.1';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          command,
          displayName,
          timeoutMs: 1000, // 1 second timeout
        });
        await step.executeAsync();
        expect(step.status).toBe(BuildStepStatus.SUCCESS);
      });

      it('fails when command exceeds timeout', async () => {
        const id = 'test1';
        const command = 'sleep 2';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          command,
          displayName,
          timeoutMs: 100, // 100ms timeout
        });

        const error = await getErrorAsync<BuildStepRuntimeError>(() => step.executeAsync());
        expect(error).toBeInstanceOf(BuildStepRuntimeError);
        expect(error.message).toMatch(/timed out after 100ms/);
        expect(step.status).toBe(BuildStepStatus.FAIL);
      });

      it('fails when function exceeds timeout', async () => {
        const id = 'test1';
        const fn = jest.fn(
          async () =>
            await new Promise((resolve) => {
              setTimeout(resolve, 2000); // 2 second delay
            })
        );
        const displayName = BuildStep.getDisplayName({ id });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          fn,
          timeoutMs: 100, // 100ms timeout
        });

        const error = await getErrorAsync<BuildStepRuntimeError>(() => step.executeAsync());
        expect(error).toBeInstanceOf(BuildStepRuntimeError);
        expect(error.message).toMatch(/timed out after 100ms/);
        expect(step.status).toBe(BuildStepStatus.FAIL);
      });

      it('works without timeout when timeoutMs is undefined', async () => {
        const id = 'test1';
        const command = 'sleep 0.1';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          command,
          displayName,
          // No timeoutMs specified
        });
        await step.executeAsync();
        expect(step.status).toBe(BuildStepStatus.SUCCESS);
      });
    });

    describe('outputs', () => {
      it('works with strings with whitespaces passed as a value for an output parameter', async () => {
        const id = 'test1';
        const command = 'set-output abc "d o m i n i k"';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          outputs: [
            new BuildStepOutput(baseStepCtx, {
              id: 'abc',
              stepDisplayName: displayName,
              required: true,
            }),
          ],
          command,
        });
        await step.executeAsync();
        const abc = nullthrows(step.outputById.abc);
        expect(abc?.value).toBe('d o m i n i k');
      });

      it('throws an error if some required outputs have not been set with set-output in script', async () => {
        const id = 'test1';
        const command = 'echo 123';
        const displayName = BuildStep.getDisplayName({ id, command });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          outputs: [
            new BuildStepOutput(baseStepCtx, {
              id: 'abc',
              stepDisplayName: displayName,
              required: true,
            }),
          ],
          command,
        });
        const error = await getErrorAsync<BuildStepRuntimeError>(() => step.executeAsync());
        expect(error).toBeInstanceOf(BuildStepRuntimeError);
        expect(error.message).toMatch(/Some required outputs have not been set: "abc"/);
      });
    });

    describe('fn', () => {
      it('executes the function passed to the step', async () => {
        const fnMock = jest.fn();

        const globalEnv = { TEST1: 'abc' };
        const stepEnv = { TEST2: 'def' };

        baseStepCtx.updateEnv(globalEnv);

        const id = 'test1';
        const displayName = BuildStep.getDisplayName({ id });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          fn: fnMock,
          env: stepEnv,
        });

        await step.executeAsync();

        expect(fnMock).toHaveBeenCalledWith(
          step.ctx,
          expect.objectContaining({
            inputs: expect.any(Object),
            outputs: expect.any(Object),
            env: expect.objectContaining({
              ...globalEnv,
              ...stepEnv,
            }),
          })
        );
      });

      it('when executing the function passed to step, step envs override global envs', async () => {
        const fnMock = jest.fn();

        const globalEnv = { TEST1: 'abc' };
        const stepEnv = { TEST1: 'def' };

        baseStepCtx.updateEnv(globalEnv);

        const id = 'test1';
        const displayName = BuildStep.getDisplayName({ id });

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          fn: fnMock,
          env: stepEnv,
        });

        await step.executeAsync();

        expect(fnMock).toHaveBeenCalledWith(
          step.ctx,
          expect.objectContaining({
            inputs: expect.any(Object),
            outputs: expect.any(Object),
            env: expect.objectContaining({
              TEST1: 'def',
            }),
          })
        );
      });

      it('passes input and outputs to the function', async () => {
        const env = { TEST_VAR_1: 'abc' };
        baseStepCtx.updateEnv(env);

        const id = 'test1';
        const displayName = BuildStep.getDisplayName({ id });

        const inputs: BuildStepInput[] = [
          new BuildStepInput(baseStepCtx, {
            id: 'foo1',
            stepDisplayName: displayName,
            defaultValue: 'bar1',
            required: true,
            allowedValueTypeName: BuildStepInputValueTypeName.STRING,
          }),
          new BuildStepInput(baseStepCtx, {
            id: 'foo2',
            stepDisplayName: displayName,
            defaultValue: 'bar2',
            allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            required: true,
          }),
          new BuildStepInput(baseStepCtx, {
            id: 'foo3',
            stepDisplayName: displayName,
            defaultValue: true,
            allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
            required: true,
          }),
          new BuildStepInput(baseStepCtx, {
            id: 'foo4',
            stepDisplayName: displayName,
            defaultValue: 27,
            allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
            required: true,
          }),
          new BuildStepInput(baseStepCtx, {
            id: 'foo5',
            stepDisplayName: displayName,
            defaultValue: {
              foo: 'bar',
            },
            allowedValueTypeName: BuildStepInputValueTypeName.JSON,
            required: true,
          }),
        ];
        const outputs: BuildStepOutput[] = [
          new BuildStepOutput(baseStepCtx, {
            id: 'abc',
            stepDisplayName: displayName,
            required: true,
          }),
        ];

        const fn: BuildStepFunction = (_ctx, { inputs, outputs }) => {
          outputs.abc.set(
            `${inputs.foo1?.value} ${inputs.foo2?.value} ${inputs.foo3?.value} ${inputs.foo4?.value}`
          );
        };

        const step = new BuildStep(baseStepCtx, {
          id,
          displayName,
          inputs,
          outputs,
          fn,
        });

        await step.executeAsync();

        expect(step.getOutputValueByName('abc')).toBe('bar1 bar2 true 27');
      });
    });
  });

  describe(BuildStep.prototype.getOutputValueByName, () => {
    let baseStepCtx: BuildStepGlobalContext;

    beforeEach(async () => {
      baseStepCtx = createGlobalContextMock();
      await fs.mkdir(baseStepCtx.defaultWorkingDirectory, { recursive: true });
      await fs.mkdir(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
    });
    afterEach(async () => {
      await fs.rm(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
    });

    it('throws an error when the step has not been executed yet', async () => {
      const id = 'test1';
      const command = 'set-output abc 123';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        outputs: [
          new BuildStepOutput(baseStepCtx, {
            id: 'abc',
            stepDisplayName: displayName,
            required: true,
          }),
        ],
        command,
      });
      const error = getError<BuildStepRuntimeError>(() => {
        step.getOutputValueByName('abc');
      });
      expect(error).toBeInstanceOf(BuildStepRuntimeError);
      expect(error.message).toMatch(/The step has not been executed yet/);
    });

    it('throws an error when trying to access a non-existent output', async () => {
      const id = 'test1';
      const command = 'set-output abc 123';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        outputs: [
          new BuildStepOutput(baseStepCtx, {
            id: 'abc',
            stepDisplayName: displayName,
            required: true,
          }),
        ],
        command,
      });
      await step.executeAsync();
      const error = getError<BuildStepRuntimeError>(() => {
        step.getOutputValueByName('def');
      });
      expect(error).toBeInstanceOf(BuildStepRuntimeError);
      expect(error.message).toMatch(/Step "test1" does not have output "def"/);
    });

    it('returns the output value', async () => {
      const id = 'test1';
      const command = 'set-output abc 123';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        outputs: [
          new BuildStepOutput(baseStepCtx, {
            id: 'abc',
            stepDisplayName: displayName,
            required: true,
          }),
        ],
        command,
      });
      await step.executeAsync();
      expect(step.getOutputValueByName('abc')).toBe('123');
    });

    it('propagates environment variables to the script', async () => {
      baseStepCtx.updateEnv({ TEST_ABC: 'lorem ipsum' });
      const logger = createMockLogger();
      const lines: string[] = [];
      jest.mocked(logger.info as any).mockImplementation((obj: object | string, line?: string) => {
        if (typeof obj === 'string') {
          lines.push(obj);
        } else if (line) {
          lines.push(line);
        }
      });
      jest.mocked(logger.child).mockReturnValue(logger);

      const id = 'test1';
      const command = 'echo "$TEST_ABC $TEST_DEF"';
      const displayName = BuildStep.getDisplayName({ id, command });

      (baseStepCtx as any).baseLogger = logger;

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        command,
        env: {
          TEST_DEF: 'dolor sit amet',
        },
      });
      await step.executeAsync();
      expect(lines.find((line) => line.match('lorem ipsum dolor sit amet'))).toBeTruthy();
    });

    it('when running a script step envs override gloabl envs', async () => {
      baseStepCtx.updateEnv({ TEST_ABC: 'lorem ipsum' });
      const logger = createMockLogger();
      const lines: string[] = [];
      jest.mocked(logger.info as any).mockImplementation((obj: object | string, line?: string) => {
        if (typeof obj === 'string') {
          lines.push(obj);
        } else if (line) {
          lines.push(line);
        }
      });
      jest.mocked(logger.child).mockReturnValue(logger);

      const id = 'test1';
      const command = 'echo $TEST_ABC';
      const displayName = BuildStep.getDisplayName({ id, command });

      (baseStepCtx as any).baseLogger = logger;

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        command,
        env: {
          TEST_ABC: 'dolor sit amet',
        },
      });
      await step.executeAsync();
      expect(lines.find((line) => line.match('dolor sit amet'))).toBeTruthy();
      expect(lines.find((line) => line.match('lorem ipsum'))).toBeUndefined();
    });

    it('executes the command with internal environment variables', async () => {
      const logger = createMockLogger();
      const lines: string[] = [];
      jest.mocked(logger.info as any).mockImplementation((obj: object | string, line?: string) => {
        if (typeof obj === 'string') {
          lines.push(obj);
        } else if (line) {
          lines.push(line);
        }
      });
      jest.mocked(logger.child).mockReturnValue(logger);

      const id = 'test1';
      const command =
        'echo $__EXPO_STEPS_BUILD_ID\necho $__EXPO_STEPS_OUTPUTS_DIR\necho $__EXPO_STEPS_ENVS_DIR\necho $__EXPO_STEPS_WORKING_DIRECTORY';
      const displayName = BuildStep.getDisplayName({ id, command });

      (baseStepCtx as any).baseLogger = logger;
      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        command,
      });
      await step.executeAsync();
      expect(
        lines.find((line) =>
          line.startsWith(path.join(baseStepCtx.stepsInternalBuildDirectory, 'steps/test1/envs'))
        )
      ).toBeTruthy();
      expect(
        lines.find((line) =>
          line.startsWith(path.join(baseStepCtx.stepsInternalBuildDirectory, 'steps/test1/outputs'))
        )
      ).toBeTruthy();
      expect(lines.find((line) => line.match(baseStepCtx.defaultWorkingDirectory))).toBeTruthy();
    });
    it('can update global env object with set-env', async () => {
      const id = 'test1';
      const command = 'set-env EXAMPLE value';
      const displayName = BuildStep.getDisplayName({ id, command });

      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        command,
      });
      await step.executeAsync();
      expect(baseStepCtx.env.EXAMPLE).toBe('value');
    });
    it('can override existing envs in global env object with set-env', async () => {
      const id = 'test1';
      const command = 'set-env EXAMPLE value';
      const displayName = BuildStep.getDisplayName({ id, command });

      baseStepCtx.updateEnv({
        EXAMPLE: 'test1',
        EXAMPLE_2: 'test2',
      });
      const step = new BuildStep(baseStepCtx, {
        id,
        displayName,
        command,
      });
      await step.executeAsync();
      expect(baseStepCtx.env.EXAMPLE).toBe('value');
      expect(baseStepCtx.env.EXAMPLE_2).toBe('test2');
    });
  });
});

describe(BuildStep.prototype.canBeRunOnRuntimePlatform, () => {
  let baseStepCtx: BuildStepGlobalContext;

  beforeEach(async () => {
    baseStepCtx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
    await fs.mkdir(baseStepCtx.defaultWorkingDirectory, { recursive: true });
    await fs.mkdir(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
  });

  it('returns true when the step does not have a platform filter', async () => {
    const id = 'test1';
    const command = 'set-output abc 123';
    const displayName = BuildStep.getDisplayName({ id, command });

    const step = new BuildStep(baseStepCtx, {
      id,
      displayName,
      command,
    });
    expect(step.canBeRunOnRuntimePlatform()).toBe(true);
  });

  it('returns true when the step has a platform filter and the platform matches', async () => {
    const id = 'test1';
    const command = 'set-output abc 123';
    const displayName = BuildStep.getDisplayName({ id, command });

    const step = new BuildStep(baseStepCtx, {
      id,
      displayName,
      supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN, BuildRuntimePlatform.LINUX],
      command,
    });
    expect(step.canBeRunOnRuntimePlatform()).toBe(true);
  });

  it('returns false when the step has a platform filter and the platform does not match', async () => {
    const id = 'test1';
    const command = 'set-output abc 123';
    const displayName = BuildStep.getDisplayName({ id, command });

    const step = new BuildStep(baseStepCtx, {
      id,
      displayName,
      supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
      command,
    });
    expect(step.canBeRunOnRuntimePlatform()).toBe(false);
  });
});

describe(BuildStep.prototype.serialize, () => {
  let baseStepCtx: BuildStepGlobalContext;

  beforeEach(async () => {
    baseStepCtx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
    await fs.mkdir(baseStepCtx.defaultWorkingDirectory, { recursive: true });
    await fs.mkdir(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
  });

  it('serializes correctly', async () => {
    const id = 'test1';
    const command = 'set-output abc 123';
    const displayName = BuildStep.getDisplayName({ id, command });

    const outputs = [
      new BuildStepOutput(baseStepCtx, {
        id: 'abc',
        stepDisplayName: displayName,
        required: true,
      }),
    ];

    const step = new BuildStep(baseStepCtx, {
      id,
      displayName,
      command,
      outputs,
    });
    expect(step.serialize()).toMatchObject({
      id,
      displayName,
      executed: false,
      outputById: {
        abc: outputs[0].serialize(),
      },
    });
  });
});

describe(BuildStep.deserialize, () => {
  let baseStepCtx: BuildStepGlobalContext;

  beforeEach(async () => {
    baseStepCtx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
    await fs.mkdir(baseStepCtx.defaultWorkingDirectory, { recursive: true });
    await fs.mkdir(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(baseStepCtx.stepsInternalBuildDirectory, { recursive: true });
  });

  it('deserializes correctly', async () => {
    const outputs = [
      new BuildStepOutput(baseStepCtx, {
        id: 'abc',
        stepDisplayName: 'Test 1',
        required: true,
      }),
    ];
    outputs[0].set('123');
    const step = BuildStep.deserialize({
      id: 'test1',
      displayName: 'Test 1',
      executed: true,
      outputById: {
        abc: outputs[0].serialize(),
      },
    });
    expect(step.id).toBe('test1');
    expect(step.displayName).toBe('Test 1');
    expect(step.getOutputValueByName('abc')).toBe('123');
  });
});

describe(BuildStep.prototype.shouldExecuteStep, () => {
  it('returns true when if condition is always and previous steps failed', () => {
    const ctx = createGlobalContextMock();
    ctx.markAsFailed();
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      ifCondition: '${ always() }',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns true when if condition is always and previous steps have not failed', () => {
    const ctx = createGlobalContextMock();
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      ifCondition: '${ always() }',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns false when if condition is success and previous steps failed', () => {
    const ctx = createGlobalContextMock();
    ctx.markAsFailed();
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      ifCondition: '${ success() }',
    });
    expect(step.shouldExecuteStep()).toBe(false);
  });

  it('returns true when a dynamic expression matches', () => {
    const ctx = createGlobalContextMock();
    ctx.updateEnv({
      NODE_ENV: 'production',
    });
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      env: {
        LOCAL_ENV: 'true',
      },
      ifCondition: '${ env.NODE_ENV === "production" && env.LOCAL_ENV === "true" }',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('can use the general interpolation context', () => {
    const ctx = createGlobalContextMock();
    ctx.updateEnv({
      CONFIG_JSON: '{"foo": "bar"}',
    });
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      ifCondition: 'fromJSON(env.CONFIG_JSON).foo == "bar"',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns true when a simplified dynamic expression matches', () => {
    const ctx = createGlobalContextMock();
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      env: {
        NODE_ENV: 'production',
      },
      ifCondition: "env.NODE_ENV === 'production'",
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns true when an input matches', () => {
    const ctx = createGlobalContextMock();
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      env: {
        NODE_ENV: 'production',
      },
      inputs: [
        new BuildStepInput(ctx, {
          id: 'foo1',
          stepDisplayName: 'Test 1',
          defaultValue: 'bar',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
      ],
      ifCondition: 'inputs.foo1 === "bar"',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns true when an eas value matches', () => {
    const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      ifCondition: 'eas.runtimePlatform === "linux"',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns true when if condition is success and previous steps have not failed', () => {
    const ctx = createGlobalContextMock();
    const step = new BuildStep(ctx, {
      id: 'test1',
      displayName: 'Test 1',
      command: 'echo 123',
      ifCondition: '${ success() }',
    });
    expect(step.shouldExecuteStep()).toBe(true);
  });

  it('returns true when if condition is failure and previous steps failed', () => {
    const ctx = createGlobalContextMock();
    ctx.markAsFailed();
    for (const ifCondition of ['${ failure() }', '${{ failure() }}']) {
      const step = new BuildStep(ctx, {
        id: 'test1',
        displayName: 'Test 1',
        command: 'echo 123',
        ifCondition,
      });
      expect(step.shouldExecuteStep()).toBe(true);
    }
  });

  it('returns false when if condition is failure and previous steps have not failed', () => {
    const ctx = createGlobalContextMock();
    for (const ifCondition of ['${ failure() }', '${{ failure() }}']) {
      const step = new BuildStep(ctx, {
        id: 'test1',
        displayName: 'Test 1',
        command: 'echo 123',
        ifCondition,
      });
      expect(step.shouldExecuteStep()).toBe(false);
    }
  });
});
