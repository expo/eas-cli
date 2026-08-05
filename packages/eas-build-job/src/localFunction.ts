/**
 * Schema for local functions, reusable units of work referenced via `uses:` in EAS workflows
 * (`.eas/workflows/*.yml`) or inline job step definitions.
 *
 * A local function configuration file (`function.yml`) declares either a composite function (a
 * group of steps under `runs.steps`, see `./compositeFunction`) or a single-step function
 * carrying a shell `command` or a `path` to a prebuilt JavaScript module (see `./legacyFunction`).
 * This module unions the two shapes.
 *
 * Callers that load local function files format validation errors from `LocalFunctionConfigZ`.
 * Any invalid file reports the single generic union message; parse a branch schema directly for
 * field-level errors. `function.yml` files cannot be referenced from `.eas/build/*.yml` custom
 * build configs.
 */
import { z } from 'zod';

import { CompositeFunctionConfig, CompositeFunctionConfigZ } from './compositeFunction';
import {
  LegacyCommandFunctionConfigZ,
  LegacyFunctionConfig,
  LegacyPathFunctionConfigZ,
} from './legacyFunction';

export const LocalFunctionConfigZ = z.union(
  [CompositeFunctionConfigZ, LegacyCommandFunctionConfigZ, LegacyPathFunctionConfigZ],
  {
    error:
      'A local function must declare exactly one of "runs.steps" (a composite function), "command" (a shell script) or "path" (a JavaScript function module), and its fields must match that shape.',
  }
);

export type LocalFunctionConfig = CompositeFunctionConfig | LegacyFunctionConfig;

export function isLegacyFunctionConfig(
  config: LocalFunctionConfig
): config is LegacyFunctionConfig {
  return config.runs === undefined;
}

export type LocalFunctionCatalog = Record<string, LocalFunctionConfig>;
