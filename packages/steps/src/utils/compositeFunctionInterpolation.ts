import { JobInterpolationContext } from '@expo/eas-build-job';

import { interpolateJobContext } from '../interpolation';

// Composite functions support only `${{ }}`; legacy `${ steps.* }` is intentionally left uninterpolated here.
export function resolveInterpolatedTarget(
  target: unknown,
  context: JobInterpolationContext
): unknown {
  return interpolateJobContext({ target, context });
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

// Matches `${{ }}` only; legacy `${ steps.* }` is unsupported inside actions.
export function containsUnresolvedTemplateReference(value: unknown): boolean {
  return typeof value === 'string' && value.includes('${{');
}
