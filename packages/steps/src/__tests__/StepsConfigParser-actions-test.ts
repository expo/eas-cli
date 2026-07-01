import { ActionCatalog, validateActionConfig } from '@expo/eas-build-job';
import { createGlobalContextMock } from './utils/context';
import { getErrorAsync } from './utils/error';
import { BuildFunction } from '../BuildFunction';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildStepOutput } from '../BuildStepOutput';
import { StepsConfigParser } from '../StepsConfigParser';
import { BuildConfigError, BuildWorkflowError } from '../errors';

function makeCatalog(entries: Record<string, unknown>): ActionCatalog {
  const catalog: ActionCatalog = {};
  for (const [ref, raw] of Object.entries(entries)) {
    catalog[ref] = validateActionConfig(raw);
  }
  return catalog;
}

function echoFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'echo',
    fn: () => {},
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'value',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        required: false,
      }),
    ],
  });
}

function setVersionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'test',
    id: 'set-version',
    fn: (_ctx, { outputs }) => {
      outputs.version.set('$(echo injected)');
    },
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'version',
        required: true,
      }),
    ],
  });
}

describe('StepsConfigParser local actions', () => {
  it('expands a single-level composite action, binding inputs and exposing outputs', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        name: 'Setup',
        inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
        outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
        runs: {
          steps: [
            { id: 'read', run: 'set-output version "1.0.0"' },
            { run: 'echo "${ inputs.greeting }"' },
          ],
        },
      },
    });

    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { greeting: 'hi' } }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    expect(workflow.buildSteps).toHaveLength(3);

    const [readStep, echoStep, outputsStep] = workflow.buildSteps;
    expect(readStep.id).toBe('setup__read');
    expect(readStep.displayName).toBe('read');
    expect(echoStep.id).toBe('setup____action_step_1');
    expect(echoStep.command).toBe('echo "hi"');

    expect(outputsStep.id).toBe('setup');
    expect(outputsStep.displayName).toBe('Setup');
    expect(outputsStep.command).toBeUndefined();
    expect(outputsStep.fn).toBeDefined();
    expect(Object.keys(outputsStep.outputById)).toEqual(['version']);
  });

  it('derives the fallback display name of an unnamed inner shell step from the substituted run', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'target', type: 'string', default_value: 'build' }],
        runs: {
          steps: [{ run: '${ inputs.target } do-thing' }],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { target: 'release' } }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    const [innerStep] = workflow.buildSteps;
    expect(innerStep.command).toBe('release do-thing');
    expect(innerStep.displayName).toBe('release do-thing');
  });

  it('sets composite action outputs via fn without shell interpolation', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        outputs: { version: { value: '${{ steps.read.outputs.version }}' } },
        runs: {
          steps: [{ id: 'read', uses: 'test/set-version' }],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup' }],
      actionCatalog,
      externalFunctions: [setVersionFunction()],
    });
    const workflow = await parser.parseAsync();
    await workflow.executeAsync();

    const outputsStep = workflow.buildSteps[1];
    expect(outputsStep.getOutputValueByName('version')).toBe('$(echo injected)');
  });

  it('uses the action input default when the caller omits the value', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
        runs: { steps: [{ run: 'echo "${ inputs.greeting }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup' }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps[0].command).toBe('echo "hello"');
  });

  it('rewrites inner steps.* references and keeps two callers isolated', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/pair': {
        runs: {
          steps: [
            { id: 'a', run: 'set-output v "x"' },
            { id: 'b', run: 'echo "${{ steps.a.outputs.v }}"' },
          ],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        { uses: './.eas/actions/pair', id: 'first' },
        { uses: './.eas/actions/pair', id: 'second' },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    const ids = workflow.buildSteps.map(s => s.id);
    expect(ids).toEqual(['first__a', 'first__b', 'second__a', 'second__b']);

    const firstB = workflow.buildSteps[1];
    const secondB = workflow.buildSteps[3];
    expect(firstB.command).toBe('echo "${{ steps.first__a.outputs.v }}"');
    expect(secondB.command).toBe('echo "${{ steps.second__a.outputs.v }}"');
  });

  it('does not rewrite step references embedded in longer identifiers', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/pair': {
        runs: {
          steps: [
            { id: 'a', run: 'set-output v "x"' },
            { id: 'b', run: 'echo "mysteps.a.outputs.v ${{ steps.a.outputs.v }}"' },
          ],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/pair', id: 'caller' }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    const bStep = workflow.buildSteps.find(s => s.id === 'caller__b');
    expect(bStep?.command).toBe('echo "mysteps.a.outputs.v ${{ steps.caller__a.outputs.v }}"');
  });

  it('rewrites the longest matching inner step id when ids share a prefix', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/pair': {
        runs: {
          steps: [
            { id: 'a', run: 'set-output v "short"' },
            { id: 'ab', run: 'set-output v "long"' },
            { id: 'c', run: 'echo "${{ steps.a.outputs.v }} ${{ steps.ab.outputs.v }}"' },
          ],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/pair', id: 'caller' }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    const cStep = workflow.buildSteps.find(s => s.id === 'caller__c');
    expect(cStep?.command).toBe(
      'echo "${{ steps.caller__a.outputs.v }} ${{ steps.caller__ab.outputs.v }}"'
    );
  });

  it('does not rewrite caller step references passed through action inputs', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/notify': {
        inputs: [{ name: 'msg', type: 'string', required: true }],
        runs: {
          steps: [{ id: 'build', run: 'echo "inner build"' }, { run: 'echo "${{ inputs.msg }}"' }],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        { id: 'build', run: 'set-output version "2.0.0"' },
        {
          uses: './.eas/actions/notify',
          id: 'notify',
          with: { msg: '${{ steps.build.outputs.version }}' },
        },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    const echoStep = workflow.buildSteps.find(
      s => s.id.startsWith('notify__') && s.id.includes('action_step')
    );
    expect(echoStep?.command).toBe('echo "${{ steps.build.outputs.version }}"');
  });

  it('rewrites inner step references in action input defaults', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/notify': {
        inputs: [
          {
            name: 'msg',
            type: 'string',
            default_value: '${{ steps.build.outputs.version }}',
          },
        ],
        runs: {
          steps: [
            { id: 'build', run: 'set-output version "1.0.0"' },
            { run: 'echo "${{ inputs.msg }}"' },
          ],
        },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/notify', id: 'notify' }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();

    const echoStep = workflow.buildSteps.find(
      s => s.id.startsWith('notify__') && s.id.includes('action_step')
    );
    expect(echoStep?.command).toBe('echo "${{ steps.notify__build.outputs.version }}"');
  });

  it('binds action inputs into inner function step inputs', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/wrap': {
        inputs: [{ name: 'msg', type: 'string', required: true }],
        runs: { steps: [{ uses: 'eas/echo', with: { value: '${{ inputs.msg }}' } }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/wrap', id: 'wrap', with: { msg: 'bound-value' } }],
      actionCatalog,
      externalFunctions: [echoFunction()],
    });
    const workflow = await parser.parseAsync();
    const echoStep = workflow.buildSteps[0];
    expect(echoStep.inputs?.[0].id).toBe('value');
    expect(echoStep.inputs?.[0].rawValue).toBe('bound-value');
  });

  it('propagates caller env and if to expanded inner steps', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        runs: { steps: [{ id: 'inner', run: 'echo hi', if: '${{ success() }}' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        {
          uses: './.eas/actions/setup',
          id: 'setup',
          env: { CALLER: 'value' },
          if: '${{ always() }}',
        },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    const inner = workflow.buildSteps[0];
    expect(inner.stepEnvOverrides).toMatchObject({ CALLER: 'value' });
    expect(inner.ifCondition).toBe('${{ (always()) && (success()) }}');
  });

  it('lets a no-if inner step inherit the caller if verbatim (preserving always())', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        runs: { steps: [{ id: 'inner', run: 'echo hi' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        {
          uses: './.eas/actions/setup',
          id: 'setup',
          if: '${{ always() }}',
        },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    const inner = workflow.buildSteps[0];
    expect(inner.ifCondition).toBe('${{ always() }}');
  });

  it('lets a no-if inner step inherit a failure() caller so failure-handling actions run', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/cleanup': {
        runs: { steps: [{ id: 'inner', run: 'echo cleanup' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        {
          uses: './.eas/actions/cleanup',
          id: 'cleanup',
          if: '${{ failure() }}',
        },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    const inner = workflow.buildSteps[0];
    expect(inner.ifCondition).toBe('${{ failure() }}');
  });

  it('leaves a no-if inner step without a condition when the caller has no if', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        runs: { steps: [{ id: 'inner', run: 'echo hi' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup' }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps[0].ifCondition).toBeUndefined();
  });

  it('expands nested composites with accumulated prefixes', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/outer': {
        runs: { steps: [{ uses: './.eas/actions/inner', id: 'mid' }] },
      },
      './.eas/actions/inner': {
        runs: { steps: [{ id: 'leaf', run: 'echo leaf' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/outer', id: 'top' }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps.map(s => s.id)).toEqual(['top__mid__leaf']);
  });

  it('throws when action nesting exceeds the maximum depth without a cycle', async () => {
    const ctx = createGlobalContextMock();
    const entries: Record<string, unknown> = {};
    for (let i = 0; i <= 11; i++) {
      entries[`./.eas/actions/a${i}`] =
        i < 11
          ? { runs: { steps: [{ uses: `./.eas/actions/a${i + 1}`, id: `s${i}` }] } }
          : { runs: { steps: [{ run: 'echo leaf' }] } };
    }
    const actionCatalog = makeCatalog(entries);
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/a0', id: 'top' }],
      actionCatalog,
    });
    const error = await getErrorAsync<BuildConfigError>(() => parser.parseAsync());
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/Maximum action nesting depth \(10\) exceeded/);
  });

  it('propagates caller working_directory to inner steps that do not declare one', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        runs: { steps: [{ id: 'inner', run: 'echo hi' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        {
          uses: './.eas/actions/setup',
          id: 'setup',
          working_directory: 'packages/app',
        },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('packages/app');
  });

  it('lets an inner step working_directory override the caller working_directory', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'dir', type: 'string', default_value: 'inner/dir' }],
        runs: { steps: [{ id: 'inner', run: 'echo hi', working_directory: '${{ inputs.dir }}' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [
        {
          uses: './.eas/actions/setup',
          id: 'setup',
          working_directory: 'caller/dir',
          with: { dir: 'overridden/dir' },
        },
      ],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps[0].ctx.relativeWorkingDirectory).toBe('overridden/dir');
  });

  it('exposes outputs from both the outer and a nested inner action', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/outer': {
        outputs: { outer_version: { value: '${{ steps.mid.outputs.inner_version }}' } },
        runs: { steps: [{ uses: './.eas/actions/inner', id: 'mid' }] },
      },
      './.eas/actions/inner': {
        outputs: { inner_version: { value: '${{ steps.read.outputs.version }}' } },
        runs: { steps: [{ id: 'read', uses: 'test/set-version' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/outer', id: 'top' }],
      actionCatalog,
      externalFunctions: [setVersionFunction()],
    });
    const workflow = await parser.parseAsync();
    await workflow.executeAsync();

    const innerOutputsStep = workflow.buildSteps.find(s => s.id === 'top__mid');
    const outerOutputsStep = workflow.buildSteps.find(s => s.id === 'top');
    expect(innerOutputsStep?.getOutputValueByName('inner_version')).toBe('$(echo injected)');
    expect(outerOutputsStep?.getOutputValueByName('outer_version')).toBe('$(echo injected)');
  });

  it('accepts an explicit boolean value for a boolean input', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'enabled', type: 'boolean' }],
        runs: { steps: [{ run: 'echo "${ inputs.enabled }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { enabled: true } }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps[0].command).toBe('echo "true"');
  });

  it('accepts an explicit number value for a number input', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'count', type: 'number' }],
        runs: { steps: [{ run: 'echo "${ inputs.count }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { count: 3 } }],
      actionCatalog,
    });
    const workflow = await parser.parseAsync();
    expect(workflow.buildSteps[0].command).toBe('echo "3"');
  });

  it('throws a clear error for an unknown action', async () => {
    const ctx = createGlobalContextMock();
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/missing', id: 'x' }],
      actionCatalog: {},
    });
    await expect(parser.parseAsync()).rejects.toThrow(/Local action ".\/.eas\/actions\/missing"/);
  });

  it('detects direct self-reference cycles', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/loop': {
        runs: { steps: [{ uses: './.eas/actions/loop', id: 'again' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/loop', id: 'loop' }],
      actionCatalog,
    });
    const error = await getErrorAsync<BuildWorkflowError>(() => parser.parseAsync());
    expect(error.message).toMatch(/cycle/i);
  });

  it('detects indirect cycles', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/a': { runs: { steps: [{ uses: './.eas/actions/b', id: 'b' }] } },
      './.eas/actions/b': { runs: { steps: [{ uses: './.eas/actions/a', id: 'a' }] } },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/a', id: 'a' }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/cycle/i);
  });

  it('errors when an inner step references a non-existent function', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/wrap': {
        runs: { steps: [{ uses: 'eas/typo', id: 'echo' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/wrap', id: 'wrap' }],
      actionCatalog,
      externalFunctions: [echoFunction()],
    });
    const error = await getErrorAsync<BuildConfigError>(() => parser.parseAsync());
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toBe(
      'Action "./.eas/actions/wrap" calls non-existent function "eas/typo".'
    );
  });

  it('errors when an inner step uses a function group', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/wrap': {
        runs: { steps: [{ uses: 'eas/build', id: 'build' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/wrap', id: 'wrap' }],
      actionCatalog,
      externalFunctionGroups: [
        new BuildFunctionGroup({
          namespace: 'eas',
          id: 'build',
          createBuildStepsFromFunctionGroupCall: () => [],
        }),
      ],
    });
    await expect(parser.parseAsync()).rejects.toThrow(
      /Function group "eas\/build" cannot be used inside an action/
    );
  });

  it('errors when a required input is missing', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'token', type: 'string', required: true }],
        runs: { steps: [{ run: 'echo "${ inputs.token }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup' }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/requires input "token"/);
  });

  it('errors when called with an unknown input', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'greeting', type: 'string' }],
        runs: { steps: [{ run: 'echo "${ inputs.greeting }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { greetng: 'hi' } }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/unknown input "greetng"/);
  });

  it('errors when a provided input has the wrong type', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'count', type: 'number' }],
        runs: { steps: [{ run: 'echo "${ inputs.count }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { count: 'two' } }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/must be of type "number"/);
  });

  it('accepts scalar values for a json input', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'config', type: 'json' }],
        runs: { steps: [{ run: 'echo "${ inputs.config }"' }] },
      },
    });
    for (const config of [5, true, 'literal']) {
      const parser = new StepsConfigParser(ctx, {
        steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { config } }],
        actionCatalog,
      });
      await expect(parser.parseAsync()).resolves.toBeDefined();
    }
  });

  it('accepts structurally equal json input when value matches allowed_values', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [
          {
            name: 'config',
            type: 'json',
            allowed_values: [{ mode: 'dev' }, { mode: 'prod' }],
          },
        ],
        runs: { steps: [{ run: 'echo done' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { config: { mode: 'dev' } } }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).resolves.toBeDefined();
  });

  it('errors when json input is not structurally equal to any allowed_values entry', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [
          {
            name: 'config',
            type: 'json',
            allowed_values: [{ mode: 'dev' }, { mode: 'prod' }],
          },
        ],
        runs: { steps: [{ run: 'echo done' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { config: { mode: 'staging' } } }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/must be one of/);
  });

  it('errors when a provided input is not in allowed_values', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'greeting', type: 'string', allowed_values: ['hi', 'hello'] }],
        runs: { steps: [{ run: 'echo "${ inputs.greeting }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { greeting: 'bye' } }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/must be one of/);
  });

  it('errors when an inner step references an undeclared input', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
        runs: { steps: [{ run: 'echo "${ inputs.gretting }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup' }],
      actionCatalog,
    });
    const error = await getErrorAsync<BuildConfigError>(() => parser.parseAsync());
    expect(error).toBeInstanceOf(BuildConfigError);
    expect(error.message).toMatch(/references undeclared input "gretting"/);
  });

  it('treats explicit null as provided instead of falling back to default_value', async () => {
    const ctx = createGlobalContextMock();
    const actionCatalog = makeCatalog({
      './.eas/actions/setup': {
        inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
        runs: { steps: [{ run: 'echo "${ inputs.greeting }"' }] },
      },
    });
    const parser = new StepsConfigParser(ctx, {
      steps: [{ uses: './.eas/actions/setup', id: 'setup', with: { greeting: null } }],
      actionCatalog,
    });
    await expect(parser.parseAsync()).rejects.toThrow(/must be of type "string"/);
  });
});
