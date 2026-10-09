/**
 * Schema for local functions, reusable units of work referenced via `uses:` in EAS workflows
 * (`.eas/workflows/*.yml`) or inline job step definitions.
 *
 * A local function configuration file (`function.yml`) declares either a composite function (a
 * group of steps under `runs.steps`, see `./compositeFunction`) or a single-step function
 * carrying a shell `command` or a `path` to a prebuilt JavaScript module (see `./legacyFunction`).
 * This module unions the two shapes.
 *
 * When a config declares exactly one of `runs`, `command` and `path`, validation failures report
 * the field-level errors of the matching branch; ambiguous shapes get a generic message listing
 * the three accepted shapes. `function.yml` files cannot be referenced from `.eas/build/*.yml`
 * custom build configs.
 */
import { z } from 'zod';

import { CompositeFunctionConfig, CompositeFunctionConfigZ } from './compositeFunction';
import {
  LegacyCommandFunctionConfigZ,
  LegacyFunctionConfig,
  LegacyPathFunctionConfigZ,
} from './legacyFunction';

const GENERIC_ERROR_MESSAGE =
  'A local function must declare exactly one of "runs.steps" (a composite function), "command" (a shell script) or "path" (a JavaScript function module), and its fields must match that shape.';

// Order must match the union options below.
const DISCRIMINATING_KEYS = ['runs', 'command', 'path'] as const;

export const LocalFunctionConfigZ = z.union(
  [CompositeFunctionConfigZ, LegacyCommandFunctionConfigZ, LegacyPathFunctionConfigZ],
  {
    error: iss => {
      if (iss.code !== 'invalid_union') {
        return GENERIC_ERROR_MESSAGE;
      }
      const input = iss.input;
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return GENERIC_ERROR_MESSAGE;
      }
      const declaredKeys = DISCRIMINATING_KEYS.filter(key => key in input);
      if (declaredKeys.length !== 1) {
        return GENERIC_ERROR_MESSAGE;
      }
      const branchErrors = iss.errors[DISCRIMINATING_KEYS.indexOf(declaredKeys[0])];
      return branchErrors
        .map(error =>
          error.path.length > 0 ? `${error.message} (at ${error.path.join('.')})` : error.message
        )
        .join('\n');
    },
  }
);

export type LocalFunctionConfig = CompositeFunctionConfig | LegacyFunctionConfig;

export function isLegacyFunctionConfig(
  config: LocalFunctionConfig
): config is LegacyFunctionConfig {
  return config.runs === undefined;
}

export type LocalFunctionCatalog = Record<string, LocalFunctionConfig>;
