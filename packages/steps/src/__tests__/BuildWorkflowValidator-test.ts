import assert from 'assert';

import { BuildStep, BuildStepFunction } from '../BuildStep.js';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput.js';
import { BuildStepOutput } from '../BuildStepOutput.js';
import { BuildWorkflow } from '../BuildWorkflow.js';
import { BuildWorkflowValidator } from '../BuildWorkflowValidator.js';
import { BuildConfigError, BuildWorkflowError } from '../errors.js';
import { BuildRuntimePlatform } from '../BuildRuntimePlatform.js';
import { BuildFunction } from '../BuildFunction.js';

import { createGlobalContextMock } from './utils/context.js';
import { getErrorAsync } from './utils/error.js';

describe(BuildWorkflowValidator, () => {
  test('non unique step ids', async () => {
    const ctx = createGlobalContextMock();
    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id: 'test1',
          displayName: BuildStep.getDisplayName({ id: 'test1', command: 'echo 123' }),
          command: 'echo 123',
        }),
        new BuildStep(ctx, {
          id: 'test1',
          displayName: BuildStep.getDisplayName({ id: 'test1', command: 'echo 456' }),
          command: 'echo 456',
        }),
        new BuildStep(ctx, {
          id: 'test1',
          displayName: BuildStep.getDisplayName({ id: 'test1', command: 'echo 789' }),
          command: 'echo 789',
        }),
        new BuildStep(ctx, {
          id: 'test3',
          displayName: BuildStep.getDisplayName({ id: 'test3', command: 'echo 123' }),
          command: 'echo 123',
        }),
        new BuildStep(ctx, {
          id: 'test3',
          displayName: BuildStep.getDisplayName({ id: 'test3', command: 'echo 456' }),
          command: 'echo 456',
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(1);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe('Duplicated step IDs: "test1", "test3"');
  });
  test('input set to a non-allowed value', async () => {
    const ctx = createGlobalContextMock();

    const id1 = 'test1';
    const command1 = 'set-output output1 123';
    const displayName1 = BuildStep.getDisplayName({ id: id1, command: command1 });

    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id: id1,
          displayName: displayName1,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input1',
              stepDisplayName: displayName1,
              required: true,
              defaultValue: '3',
              allowedValues: ['1', '2'],
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
            new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
              id: 'input2',
              stepDisplayName: displayName1,
              required: true,
              defaultValue: '3',
              allowedValues: [true, false],
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command: command1,
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(2);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      'Input parameter "input1" for step "test1" is set to "3" which is not one of the allowed values: "1", "2".'
    );
    expect(error.errors[1].message).toBe(
      'Input parameter "input2" for step "test1" is set to "3" which is not one of the allowed values: "true", "false".'
    );
  });
  test('required function input without default value and value passed to step', async () => {
    const ctx = createGlobalContextMock();

    const func = new BuildFunction({
      id: 'say_hi',
      inputProviders: [
        BuildStepInput.createProvider({
          id: 'id1',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
      ],
      command: 'echo "hi"',
    });

    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        func.createBuildStepFromFunctionCall(ctx, {
          id: 'step_id',
          callInputs: {},
        }),
      ],
      buildFunctions: {
        say_hi: func,
      },
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    expect((error as BuildWorkflowError).errors[0].message).toBe(
      'Input parameter "id1" for step "step_id" is required but it was not set.'
    );
  });
  test('invalid input type passed to step', async () => {
    const ctx = createGlobalContextMock();

    const func = new BuildFunction({
      id: 'say_hi',
      inputProviders: [
        BuildStepInput.createProvider({
          id: 'id1',
          required: true,
          allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        }),
        BuildStepInput.createProvider({
          id: 'id2',
          allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'id3',
          allowedValueTypeName: BuildStepInputValueTypeName.JSON,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'id4',
          allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'id5',
          allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
          required: true,
        }),
        BuildStepInput.createProvider({
          id: 'id6',
          allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
          required: true,
        }),
      ],
      command: 'echo "hi"',
    });

    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        func.createBuildStepFromFunctionCall(ctx, {
          id: 'step_id',
          callInputs: {
            id1: 123,
            id2: {
              a: 1,
              b: 2,
            },
            id3: 'abc',
            id4: '${ steps.step_id.output1 }',
            id5: '${ eas.job.version.buildNumber }',
            id6: '${ wrong.aaa }',
          },
        }),
      ],
      buildFunctions: {
        say_hi: func,
      },
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    expect((error as BuildWorkflowError).errors[0].message).toBe(
      'Input parameter "id1" for step "step_id" is set to "123" which is not of type "string" or is not step or context reference.'
    );
    expect((error as BuildWorkflowError).errors[1].message).toBe(
      'Input parameter "id2" for step "step_id" is set to "{"a":1,"b":2}" which is not of type "number" or is not step or context reference.'
    );
    expect((error as BuildWorkflowError).errors[2].message).toBe(
      'Input parameter "id3" for step "step_id" is set to "abc" which is not of type "json" or is not step or context reference.'
    );
    expect((error as BuildWorkflowError).errors[3].message).toBe(
      'Input parameter "id6" for step "step_id" is set to "${ wrong.aaa }" which is not of type "number" or is not step or context reference.'
    );
  });
  test('output from future step', async () => {
    const ctx = createGlobalContextMock();

    const id1 = 'test1';
    const command1 = 'set-output output1 123';
    const displayName1 = BuildStep.getDisplayName({ id: id1, command: command1 });

    const id2 = 'test2';
    const command2 = 'set-output output1 123';
    const displayName2 = BuildStep.getDisplayName({ id: id2, command: command2 });

    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id: id1,
          displayName: displayName1,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input1',
              stepDisplayName: displayName1,
              required: true,
              defaultValue: '${ steps.test2.output1 }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command: command1,
        }),
        new BuildStep(ctx, {
          id: id2,
          displayName: displayName2,
          outputs: [
            new BuildStepOutput(ctx, {
              id: 'output1',
              stepDisplayName: displayName2,
              required: true,
            }),
          ],
          command: command2,
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(1);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      'Input parameter "input1" for step "test1" uses an expression that references an output parameter from the future step "test2".'
    );
  });
  test('output from non-existent step', async () => {
    const id = 'test2';
    const command = 'echo ${ inputs.input1 }';
    const displayName = BuildStep.getDisplayName({ id, command });

    const ctx = createGlobalContextMock();
    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id,
          displayName,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input1',
              stepDisplayName: displayName,
              required: true,
              defaultValue: '${ steps.test1.output1 }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command,
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(1);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      'Input parameter "input1" for step "test2" uses an expression that references an output parameter from a non-existent step "test1".'
    );
  });
  test('undefined output', async () => {
    const id1 = 'test1';
    const command1 = 'set-output output1 123';
    const displayName1 = BuildStep.getDisplayName({ id: id1, command: command1 });

    const id2 = 'test2';
    const command2 = 'echo ${ inputs.input1 }';
    const displayName2 = BuildStep.getDisplayName({ id: id2, command: command2 });

    const id3 = 'test3';
    const command3 = 'echo ${ inputs.input1 }';
    const displayName3 = BuildStep.getDisplayName({ id: id3, command: command3 });

    const ctx = createGlobalContextMock();
    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id: id1,
          displayName: displayName1,
          outputs: [
            new BuildStepOutput(ctx, {
              id: 'output1',
              stepDisplayName: displayName1,
              required: true,
            }),
          ],
          command: command1,
        }),
        new BuildStep(ctx, {
          id: id2,
          displayName: displayName2,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input1',
              stepDisplayName: displayName2,
              required: true,
              defaultValue: '${ steps.test1.output1 }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command: command2,
        }),
        new BuildStep(ctx, {
          id: id3,
          displayName: displayName3,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input2',
              stepDisplayName: displayName3,
              required: true,
              defaultValue: '${ steps.test2.output2 }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command: command3,
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(1);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      'Input parameter "input2" for step "test3" uses an expression that references an undefined output parameter "output2" from step "test2".'
    );
  });
  test('multiple config errors', async () => {
    const id1 = 'test1';
    const command1 = 'set-output output1 123';
    const displayName1 = BuildStep.getDisplayName({ id: id1, command: command1 });

    const id2 = 'test2';
    const command2 = 'echo ${ inputs.input1 }';
    const displayName2 = BuildStep.getDisplayName({ id: id2, command: command2 });

    const id3 = 'test3';
    const command3 = 'echo ${ inputs.input1 }';
    const displayName3 = BuildStep.getDisplayName({ id: id3, command: command3 });

    const ctx = createGlobalContextMock();
    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id: id1,
          displayName: displayName1,
          outputs: [
            new BuildStepOutput(ctx, {
              id: 'output1',
              stepDisplayName: displayName1,
              required: true,
            }),
          ],
          command: command1,
        }),
        new BuildStep(ctx, {
          id: id2,
          displayName: displayName2,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input1',
              stepDisplayName: displayName2,
              required: true,
              defaultValue: '${ steps.test4.output1 }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command: command2,
        }),
        new BuildStep(ctx, {
          id: id3,
          displayName: displayName3,
          inputs: [
            new BuildStepInput(ctx, {
              id: 'input2',
              stepDisplayName: displayName3,
              required: true,
              defaultValue: '${ steps.test2.output2 }',
              allowedValueTypeName: BuildStepInputValueTypeName.STRING,
            }),
          ],
          command: 'echo ${ inputs.input2 }',
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(2);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      'Input parameter "input1" for step "test2" uses an expression that references an output parameter from a non-existent step "test4".'
    );
    expect(error.errors[1]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[1].message).toBe(
      'Input parameter "input2" for step "test3" uses an expression that references an undefined output parameter "output2" from step "test2".'
    );
  });
  test('unallowed platform for build step', async () => {
    const id = 'test';
    const displayName = BuildStep.getDisplayName({ id });
    const fn: BuildStepFunction = () => {};

    const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [
        new BuildStep(ctx, {
          id,
          displayName,
          fn,
          supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
        }),
      ],
      buildFunctions: {},
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    expect(error).toBeInstanceOf(BuildWorkflowError);
    assert(error instanceof BuildWorkflowError);
    expect(error.errors.length).toBe(1);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      `Step "${displayName}" is not allowed on platform "${BuildRuntimePlatform.LINUX}". Allowed platforms for this step are: "${BuildRuntimePlatform.DARWIN}".`
    );
  });

  test('non-existing custom function module', async () => {
    const ctx = createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX });
    const workflow = new BuildWorkflow(ctx, {
      buildSteps: [],
      buildFunctions: {
        test: new BuildFunction({
          id: 'test',
          customFunctionModulePath: '/non/existent/module',
        }),
      },
    });

    const validator = new BuildWorkflowValidator(workflow);
    const error = await getErrorAsync<BuildWorkflowError>(async () => {
      await validator.validateAsync();
    });
    assert(error instanceof BuildWorkflowError);
    expect(error).toBeInstanceOf(BuildWorkflowError);
    expect(error.errors.length).toBe(1);
    expect(error.errors[0]).toBeInstanceOf(BuildConfigError);
    expect(error.errors[0].message).toBe(
      `Custom function module path "/non/existent/module" for function "test" does not exist.`
    );
  });
});
