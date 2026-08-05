/**
 * Legacy single-step local function shape: shell `command` or JS module `path` in `function.yml`.
 * Branches of `LocalFunctionConfigZ` in `./localFunction`.
 */
import { z } from 'zod';

import { CompositeFunctionInputZ } from './compositeFunction';

const LegacyFunctionOutputZ = z.union([
  z.string().describe('Shorthand for a required output name.'),
  z
    .object({
      name: z.string(),
      required: z.boolean().optional(),
    })
    .strict(),
]);

const LegacyFunctionPlatformZ = z.enum(['darwin', 'linux']);

const LegacyFunctionBaseZ = z.object({
  /**
   * @example
   * name: Say hi
   */
  name: z.string().optional().describe('Display name of the function.'),
  /**
   * @example
   * inputs:
   *   - greeting
   *   - name: platform
   *     type: string
   *     default_value: ios
   */
  inputs: z
    .array(CompositeFunctionInputZ)
    .optional()
    .describe(
      'Inputs accepted by the function. Each input is required unless it sets `required: false`.'
    ),
  /**
   * @example
   * outputs:
   *   - name: version
   *   - name: sha
   *     required: false
   */
  outputs: z
    .array(LegacyFunctionOutputZ)
    .optional()
    .describe(
      'Outputs the function sets. Each output is required unless it sets `required: false`.'
    ),
  shell: z.string().optional().describe('Shell to run the function with.'),
  supported_platforms: z
    .array(LegacyFunctionPlatformZ)
    .optional()
    .describe('Runtime platforms the function can run on.'),
  runs: z.never().optional(),
});

export const LegacyCommandFunctionConfigZ = LegacyFunctionBaseZ.extend({
  /**
   * @example
   * command: echo "Hi, ${ inputs.name }!"
   */
  command: z.string().describe('Shell script executed when the function is invoked.'),
  path: z.never().optional(),
}).strict();

export const LegacyPathFunctionConfigZ = LegacyFunctionBaseZ.extend({
  /**
   * @example
   * path: ./my-function
   */
  path: z
    .string()
    .describe(
      'Directory with a prebuilt JavaScript module and its package.json, resolved relative to the function file.'
    ),
  command: z.never().optional(),
}).strict();

/**
 * Structure of a single-step local function configuration file (`function.yml`).
 *
 * @example
 * name: Say hi
 * inputs:
 *   - name
 * command: echo "Hi, ${ inputs.name }!"
 */
export type LegacyFunctionConfig =
  | z.infer<typeof LegacyCommandFunctionConfigZ>
  | z.infer<typeof LegacyPathFunctionConfigZ>;
