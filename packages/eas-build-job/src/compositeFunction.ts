/**
 * Schema for local composite functions, reusable step groups referenced via `uses:` in EAS
 * workflows (`.eas/workflows/*.yml`) or inline job step definitions.
 *
 * This module defines the shape of a composite function configuration file (`function.yml`).
 * Callers that load composite function files format validation errors from `CompositeFunctionConfigZ`.
 * Local composite functions are not supported in `.eas/build/*.yml` custom build config files.
 */
import { z } from 'zod';

import { StepZ } from './step';

const CompositeFunctionInputValueTypeNameZ = z.enum(['string', 'boolean', 'number', 'json']);

const CompositeFunctionInputValueZ = z.union([
  z.string(),
  z.boolean(),
  z.number(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

const CompositeFunctionInputZ = z.union([
  z
    .string()
    .describe('Shorthand for an input name with default type "string" and no default value.'),
  z
    .object({
      name: z.string(),
      type: CompositeFunctionInputValueTypeNameZ.default('string'),
      default_value: CompositeFunctionInputValueZ.optional(),
      allowed_values: z.array(CompositeFunctionInputValueZ).optional(),
      required: z.boolean().optional(),
    })
    .strict(),
]);

const CompositeFunctionOutputZ = z
  .object({
    description: z.string().optional(),
    /**
     * @example
     * value: '${{ steps.read.outputs.version }}'
     */
    value: z.string().describe('Expression that resolves to the output value.'),
  })
  .strict();

export const CompositeFunctionConfigZ = z
  .object({
    /**
     * @example
     * name: Setup
     */
    name: z.string().optional().describe('Display name of the composite function.'),
    description: z.string().optional(),
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
      .describe('Inputs accepted by the composite function.'),
    /**
     * @example
     * outputs:
     *   version:
     *     value: '${{ steps.read.outputs.version }}'
     */
    outputs: z
      .record(z.string(), CompositeFunctionOutputZ)
      .optional()
      .describe('Named outputs exposed by the composite function to its caller.'),
    runs: z.object({
      /**
       * @example
       * runs:
       *   steps:
       *     - id: read
       *       run: set-output version "1.0.0"
       */
      steps: z
        .array(StepZ)
        .min(1, {
          message: 'A composite function must declare at least one step under "runs.steps".',
        })
        .describe('Steps executed when the composite function is invoked.'),
    }),
  })
  .strict();

/**
 * Structure of a local composite function configuration file (`function.yml`).
 *
 * @example
 * name: Setup
 * inputs:
 *   - greeting
 * outputs:
 *   version:
 *     value: '${{ steps.read.outputs.version }}'
 * runs:
 *   steps:
 *     - id: read
 *       run: set-output version "1.0.0"
 */
export type CompositeFunctionConfig = z.infer<typeof CompositeFunctionConfigZ>;

export type CompositeFunctionCatalog = Record<string, CompositeFunctionConfig>;
