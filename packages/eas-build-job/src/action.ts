/**
 * Schema for composite actions, reusable step groups referenced via `uses:` in EAS
 * workflows (`.eas/workflows/*.yml`) or inline job step definitions.
 *
 * This module defines the shape of an action configuration file (`action.yml`).
 * Callers that load action files format validation errors from `ActionConfigZ`.
 * Actions are not supported in `.eas/build/*.yml` custom build config files.
 */
import { z } from 'zod';

import { StepZ } from './step';

const ActionInputValueTypeNameZ = z.enum(['string', 'boolean', 'number', 'json']);

const ActionInputValueZ = z.union([
  z.string(),
  z.boolean(),
  z.number(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

const ActionInputZ = z.union([
  z
    .string()
    .describe('Shorthand for an input name with default type "string" and no default value.'),
  z
    .object({
      name: z.string(),
      type: ActionInputValueTypeNameZ.default('string'),
      default_value: ActionInputValueZ.optional(),
      allowed_values: z.array(ActionInputValueZ).optional(),
      required: z.boolean().optional(),
    })
    .strict(),
]);

const ActionOutputZ = z
  .object({
    description: z.string().optional(),
    /**
     * @example
     * value: '${{ steps.read.outputs.version }}'
     */
    value: z.string().describe('Expression that resolves to the output value.'),
  })
  .strict();

export const ActionConfigZ = z
  .object({
    /**
     * @example
     * name: Setup
     */
    name: z.string().optional().describe('Display name of the action.'),
    description: z.string().optional(),
    /**
     * @example
     * inputs:
     *   - greeting
     *   - name: platform
     *     type: string
     *     default_value: ios
     */
    inputs: z.array(ActionInputZ).optional().describe('Inputs accepted by the action.'),
    /**
     * @example
     * outputs:
     *   version:
     *     value: '${{ steps.read.outputs.version }}'
     */
    outputs: z
      .record(z.string(), ActionOutputZ)
      .optional()
      .describe('Named outputs exposed by the action to its caller.'),
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
        .min(1, { message: 'An action must declare at least one step under "runs.steps".' })
        .describe('Steps executed when the action is invoked.'),
    }),
  })
  .strict();

/**
 * Structure of an action configuration file (`action.yml`).
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
export type ActionConfig = z.infer<typeof ActionConfigZ>;

export type ActionCatalog = Record<string, ActionConfig>;
