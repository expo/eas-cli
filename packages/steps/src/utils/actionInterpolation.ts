import { JobInterpolationContext } from '@expo/eas-build-job';

import { BUILD_STEP_OUTPUT_EXPRESSION_REGEXP, interpolateWithOutputs } from './template';
import { interpolateJobContext } from '../interpolation';

// Non-string results skip the legacy resolver: `${ steps.* }` only appears inside strings.
export function resolveInterpolatedTarget(
  target: unknown,
  context: JobInterpolationContext,
  legacyResolver: (path: string) => string
): unknown {
  const resolved = interpolateJobContext({ target, context });
  if (typeof resolved === 'string') {
    return interpolateWithOutputs(resolved, legacyResolver);
  }
  return resolved;
}

export function stringifyInterpolatedResult(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function stringifyOptionalInterpolatedResult(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return stringifyInterpolatedResult(value);
}

// Matches `${{ }}` or legacy `${ steps.* }` only; shell `${FOO:-bar}` / `${ inputs.* }` are excluded.
export function containsUnresolvedTemplateReference(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value.includes('${{') || BUILD_STEP_OUTPUT_EXPRESSION_REGEXP.test(value))
  );
}
