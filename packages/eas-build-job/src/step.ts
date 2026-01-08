import { z } from 'zod';

const CommonStepZ = z.object({
  /**
   * Unique identifier for the step.
   *
   * @example
   * id: step1
   */
  id: z
    .string()
    .optional()
    .describe(
      `ID of the step. Useful for later referencing the job's outputs. Example: step with id "setup" and an output "platform" will expose its value under "steps.setup.outputs.platform".`
    ),
  /**
   * Expression that determines whether the step should run.
   * Based on the GitHub Actions job step `if` field (https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsif).
   */
  if: z.string().optional().describe('Expression that determines whether the step should run.'),
  /**
   * The name of the step.
   *
   * @example
   * name: 'Step 1'
   */
  name: z.string().optional().describe('Name of the step.'),
  /**
   * The working directory to run the step in.
   *
   * @example
   * working_directory: ./my-working-directory
   *
   * @default depends on the project settings
   */
  working_directory: z
    .string()
    .optional()
    .describe(
      `Working directory to run the step in. Relative paths like "./assets" or "assets" are resolved from the app's base directory. Absolute paths like "/apps/mobile" are resolved from the repository root.`
    ),
  /**
   * Env variables override for the step.
   *
   * @example
   * env:
   *   MY_ENV_VAR: my-value
   *   ANOTHER_ENV_VAR: another-value
   */
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Additional environment variables to set for the step.'),
});

export const FunctionStepZ = CommonStepZ.extend({
  /**
   * The custom EAS function to run as a step.
   * It can be a function provided by EAS or a custom function defined by the user.
   *
   * @example
   * uses: eas/build
   *
   * @example
   * uses: my-custom-function
   */
  uses: z
    .string()
    .describe(
      'Name of the function to use for this step. See https://docs.expo.dev/custom-builds/schema/#built-in-eas-functions for available functions.'
    ),
  /**
   * The arguments to pass to the function.
   *
   * @example
   * with:
   *   arg1: value1
   *   arg2: ['ala', 'ma', 'kota']
   *   arg3:
   *     key1: value1
   *     key2:
   *      - value1
   *   arg4: ${{ steps.step1.outputs.test }}
   */
  with: z.record(z.string(), z.unknown()).optional().describe('Inputs to the function.'),

  run: z.never().optional(),
  shell: z.never().optional(),
  outputs: z.never().optional(),
});

export type FunctionStep = z.infer<typeof FunctionStepZ>;

export const ShellStepZ = CommonStepZ.extend({
  /**
   * The command-line programs to run as a step.
   *
   * @example
   * run: echo Hello, world!
   *
   * @example
   * run: |
   *  npm install
   *  npx expo prebuild
   *  pod install
   */
  run: z.string().describe('Shell script to run in the step.'),
  /**
   * The shell to run the "run" command with.
   *
   * @example
   * shell: 'sh'
   *
   * @default 'bash'
   */
  shell: z.string().optional().describe('Shell to run the "run" command with.'),
  /**
   * The outputs of the step.
   *
   * @example
   * outputs:
   *  - name: my_output
   *    required: true
   *  - name: my_optional_output
   *    required: false
   *  - name: my_optional_output_without_required
   */
  outputs: z
    .array(
      z.union([
        // We allow a shorthand for outputs
        z.codec(z.string(), z.object({ name: z.string(), required: z.boolean().default(false) }), {
          decode: (name) => ({ name, required: false }),
          encode: (output) => output.name,
        }),
        z.object({
          name: z.string(),
          required: z.boolean().optional(),
        }),
      ])
    )
    .optional(),

  uses: z.never().optional(),
  with: z.never().optional(),
});

export type ShellStep = z.infer<typeof ShellStepZ>;

export const StepZ = z.union([ShellStepZ, FunctionStepZ]);

/**
 * Structure of a custom EAS job step.
 *
 * GHA step fields skipped here:
 * - `with.entrypoint`
 * - `continue-on-error`
 * - `timeout-minutes`
 *
 * * @example
 * steps:
 *  - uses: eas/maestro-test
 *    id: step1
 *    name: Step 1
 *    with:
 *      flow_path: |
 *        maestro/sign_in.yaml
 *        maestro/create_post.yaml
 *        maestro/sign_out.yaml
 *  - run: echo Hello, world!
 */
export type Step = z.infer<typeof StepZ>;

export function validateSteps(maybeSteps: unknown): Step[] {
  const steps = z.array(StepZ).min(1).parse(maybeSteps);
  return steps;
}

export function isStepShellStep(step: Step): step is ShellStep {
  return step.run !== undefined;
}

export function isStepFunctionStep(step: Step): step is FunctionStep {
  return step.uses !== undefined;
}
