import assert from 'node:assert';

import {
  SETUP,
  echoFunction,
  parseCompositeFunctions,
} from './StepsConfigParser-composite-functions-test-utils';
import { getErrorAsync } from './utils/error';
import { BuildFunctionGroup } from '../BuildFunctionGroup';
import { BuildConfigError, BuildWorkflowError } from '../errors';

describe('StepsConfigParser local composite functions', () => {
  describe('expansion', () => {
    it('expands a single-level composite function and leaves input templates raw', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            name: 'Setup',
            inputs: [{ name: 'greeting', type: 'string', default_value: 'hello' }],
            runs: {
              steps: [
                { id: 'read', run: 'set-output version "1.0.0"' },
                { run: 'echo "${{ inputs.greeting }}"' },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { greeting: 'hi' } }],
      });

      expect(workflow.buildSteps).toHaveLength(2);

      const [readStep, echoStep] = workflow.buildSteps;
      expect(readStep.id).toBe('setup__read');
      expect(readStep.displayName).toBe('read');
      expect(echoStep.id).toBe('setup__composite_function_step_1');
      expect(echoStep.command).toBe('echo "${{ inputs.greeting }}"');
    });

    it('generates a synthetic id when the caller step has no id', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            name: 'Setup',
            runs: {
              steps: [
                { id: 'read', run: 'set-output version "1.0.0"' },
                { id: 'echo', run: 'echo "${{ steps.read.outputs.version }}"' },
              ],
            },
          },
        },
        steps: [{ uses: SETUP }],
      });

      const [readStep, echoStep] = workflow.buildSteps;
      const syntheticStepId = readStep.id.split('__')[0];

      expect(workflow.buildSteps).toHaveLength(2);
      expect(syntheticStepId).toMatch(/^step-\d{3,}$/);
      expect(readStep.id).toBe(`${syntheticStepId}__read`);
      expect(echoStep.command).toBe('echo "${{ steps.read.outputs.version }}"');
    });

    it('keeps templated inner step names raw at parse time', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'env', type: 'string', default_value: 'staging' }],
            runs: {
              steps: [{ name: 'Deploy ${{ inputs.env }}', run: 'echo deploy' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { env: 'production' } }],
      });

      expect(workflow.buildSteps[0].displayName).toBe('Deploy ${{ inputs.env }}');
    });

    it('derives the fallback display name of an unnamed inner shell step from the raw run', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'target', type: 'string', default_value: 'build' }],
            runs: {
              steps: [{ run: '${{ inputs.target }} do-thing' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup', with: { target: 'release' } }],
      });

      const [innerStep] = workflow.buildSteps;
      expect(innerStep.command).toBe('${{ inputs.target }} do-thing');
      expect(innerStep.displayName).toBe('${{ inputs.target }} do-thing');
    });

    it('expands nested composites with accumulated prefixes', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          './.eas/functions/outer': {
            runs: { steps: [{ uses: './.eas/functions/inner', id: 'mid' }] },
          },
          './.eas/functions/inner': {
            runs: { steps: [{ id: 'leaf', run: 'echo leaf' }] },
          },
        },
        steps: [{ uses: './.eas/functions/outer', id: 'top' }],
      });
      expect(workflow.buildSteps.map(s => s.id)).toEqual(['top__mid__leaf']);
    });

    it('avoids collisions between generated inner step ids and declared inner step ids', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            runs: {
              steps: [
                { run: 'echo first (no id)' },
                { id: 'composite_function_step_1', run: 'echo second (declared)' },
              ],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });

      expect(workflow.buildSteps.map(s => s.id)).toEqual([
        'setup__composite_function_step_2',
        'setup__composite_function_step_1',
      ]);
    });
  });
  describe('resolution errors', () => {
    it('throws a clear error for an unknown composite function', async () => {
      await expect(
        parseCompositeFunctions({
          steps: [{ uses: './.eas/functions/missing', id: 'x' }],
        })
      ).rejects.toThrow(/Local composite function ".\/.eas\/functions\/missing"/);
    });

    it.each([
      [
        'direct self-reference',
        {
          './.eas/functions/loop': {
            runs: { steps: [{ uses: './.eas/functions/loop', id: 'again' }] },
          },
        },
        [{ uses: './.eas/functions/loop', id: 'loop' }],
      ],
      [
        'indirect reference',
        {
          './.eas/functions/a': { runs: { steps: [{ uses: './.eas/functions/b', id: 'b' }] } },
          './.eas/functions/b': { runs: { steps: [{ uses: './.eas/functions/a', id: 'a' }] } },
        },
        [{ uses: './.eas/functions/a', id: 'a' }],
      ],
    ])('detects %s cycles', async (_, catalog, steps) => {
      await expect(parseCompositeFunctions({ catalog, steps })).rejects.toThrow(/cycle/i);
    });

    it('errors when a composite function declares duplicated inner step ids', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseCompositeFunctions({
          catalog: {
            [SETUP]: {
              runs: {
                steps: [
                  { run: 'echo one', id: 'dup' },
                  { run: 'echo two', id: 'dup' },
                ],
              },
            },
          },
          steps: [{ uses: SETUP, id: 'setup' }],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toBe(
        `Composite function "${SETUP}" declares duplicated step IDs: "dup". Step IDs within a composite function must be unique.`
      );
    });

    it('errors when an inner step references a non-existent function', async () => {
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseCompositeFunctions({
          catalog: {
            './.eas/functions/wrap': {
              runs: { steps: [{ uses: 'eas/typo', id: 'echo' }] },
            },
          },
          steps: [{ uses: './.eas/functions/wrap', id: 'wrap' }],
          externalFunctions: [echoFunction()],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toBe(
        'Composite function "./.eas/functions/wrap" calls non-existent function "eas/typo".'
      );
    });

    it('errors when an inner step uses a function group', async () => {
      await expect(
        parseCompositeFunctions({
          catalog: {
            './.eas/functions/wrap': {
              runs: { steps: [{ uses: 'eas/build', id: 'build' }] },
            },
          },
          steps: [{ uses: './.eas/functions/wrap', id: 'wrap' }],
          externalFunctionGroups: [
            new BuildFunctionGroup({
              namespace: 'eas',
              id: 'build',
              createBuildStepsFromFunctionGroupCall: () => [],
            }),
          ],
        })
      ).rejects.toThrow(/Function group "eas\/build" cannot be used inside a composite function/);
    });

    it('allows composite function chains at the maximum nesting depth without a cycle', async () => {
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < 10; i++) {
        entries[`./.eas/functions/a${i}`] =
          i < 9
            ? { runs: { steps: [{ uses: `./.eas/functions/a${i + 1}`, id: `s${i}` }] } }
            : { runs: { steps: [{ run: 'echo leaf' }] } };
      }
      const workflow = await parseCompositeFunctions({
        catalog: entries,
        steps: [{ uses: './.eas/functions/a0', id: 'top' }],
      });
      expect(workflow).toBeDefined();
    });

    it('throws when composite function nesting exceeds the maximum depth without a cycle', async () => {
      const entries: Record<string, unknown> = {};
      for (let i = 0; i <= 10; i++) {
        entries[`./.eas/functions/a${i}`] =
          i < 10
            ? { runs: { steps: [{ uses: `./.eas/functions/a${i + 1}`, id: `s${i}` }] } }
            : { runs: { steps: [{ run: 'echo leaf' }] } };
      }
      const error = await getErrorAsync<BuildConfigError>(() =>
        parseCompositeFunctions({
          catalog: entries,
          steps: [{ uses: './.eas/functions/a0', id: 'top' }],
        })
      );
      expect(error).toBeInstanceOf(BuildConfigError);
      expect(error.message).toMatch(/Maximum composite function nesting depth \(10\) exceeded/);
    });
  });
  describe('step id collisions', () => {
    it('reports a clear error when a user step id collides with an expanded composite function step id', async () => {
      const error = await getErrorAsync<BuildWorkflowError>(() =>
        parseCompositeFunctions({
          catalog: { [SETUP]: { runs: { steps: [{ id: 'read', run: 'true' }] } } },
          steps: [
            { id: 'setup__read', run: 'true' },
            { uses: SETUP, id: 'setup' },
          ],
        })
      );
      expect(error).toBeInstanceOf(BuildWorkflowError);
      assert(error instanceof BuildWorkflowError);
      expect(error.errors[0].message).toBe('Duplicated step IDs: "setup__read"');
    });
  });
  describe('expression tokenization', () => {
    it('substitutes inputs adjacent to arithmetic operators in inner run commands', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [
              { name: 'total', type: 'number', default_value: 10 },
              { name: 'count', type: 'number', default_value: 2 },
            ],
            runs: {
              steps: [{ run: 'echo ${{ inputs.total/inputs.count }}' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });
      expect(workflow.buildSteps[0].command).toBe('echo ${{ inputs.total/inputs.count }}');
    });

    it('does not truncate inner expressions at }} inside string literals', async () => {
      const workflow = await parseCompositeFunctions({
        catalog: {
          [SETUP]: {
            inputs: [{ name: 'platform', type: 'string', default_value: 'android' }],
            runs: {
              steps: [{ run: 'echo hi', if: '${{ contains(inputs.platform, "a}}b") }}' }],
            },
          },
        },
        steps: [{ uses: SETUP, id: 'setup' }],
      });
      expect(workflow.buildSteps[0].ifCondition).toBe('${{ contains(inputs.platform, "a}}b") }}');
    });
  });
});
