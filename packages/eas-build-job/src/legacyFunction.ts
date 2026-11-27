/**
 * Legacy single-step local function shape: shell `command` or JS module `path` in `function.yml`.
 * Branches of `LocalFunctionConfigZ` in `./localFunction`.
 *
 * The Joi schema for custom build configs (`BuildFunctionConfigSchema` in `@expo/steps`) uses
 * camelCase keys natively and treats snake_case as rename aliases, so functions copied from
 * `.eas/build/*.yml` may use either spelling. These schemas accept both and normalize camelCase
 * to the canonical snake_case, so parsed configs always carry snake_case keys.
 */
import { z } from 'zod';

import { CompositeFunctionInputZ } from './compositeFunction';

const LEGACY_FUNCTION_KEY_ALIASES = {
  supportedRuntimePlatforms: 'supported_platforms',
} as const;

const LEGACY_FUNCTION_INPUT_KEY_ALIASES = {
  defaultValue: 'default_value',
  allowedValues: 'allowed_values',
  allowedValueType: 'type',
} as const;

// Mirrors Joi's `.rename(alias, canonical)`: when both spellings are present, the alias key is
// left in place so the strict object schema rejects it.
function renameAliasKeys(value: unknown, aliases: Record<string, string>): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const result: Record<string, unknown> = { ...value };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in result && !(canonical in result)) {
      result[canonical] = result[alias];
      delete result[alias];
    }
  }
  return result;
}

const LegacyFunctionInputZ = z.preprocess(
  value => renameAliasKeys(value, LEGACY_FUNCTION_INPUT_KEY_ALIASES),
  CompositeFunctionInputZ
);

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
    .array(LegacyFunctionInputZ)
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

export const LegacyCommandFunctionConfigZ = z.preprocess(
  value => renameAliasKeys(value, LEGACY_FUNCTION_KEY_ALIASES),
  LegacyFunctionBaseZ.extend({
    /**
     * @example
     * command: echo "Hi, ${ inputs.name }!"
     */
    command: z.string().describe('Shell script executed when the function is invoked.'),
    path: z.never().optional(),
  }).strict()
);

export const LegacyPathFunctionConfigZ = z.preprocess(
  value => renameAliasKeys(value, LEGACY_FUNCTION_KEY_ALIASES),
  LegacyFunctionBaseZ.extend({
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
  }).strict()
);

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
