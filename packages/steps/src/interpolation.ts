import { JobInterpolationContext } from '@expo/eas-build-job';

import { jsepEval } from './utils/jsepEval';
import {
  BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP,
  BUILD_STEP_INPUT_EXPRESSION_REGEXP,
  BUILD_STEP_OUTPUT_EXPRESSION_REGEXP,
  interpolateTemplate,
} from './utils/template';

function isSingleWholeStringInterpolation(value: string): boolean {
  return value.startsWith('${{') && value.endsWith('}}') && !value.includes('${{', 3);
}

type LegacyResolver = (path: string) => string;

export function interpolateJobContext({
  target,
  context,
  legacyResolvers = {},
}: {
  target: unknown;
  context: JobInterpolationContext;
  // A legacy `${ ... }` syntax without a resolver stays literal.
  legacyResolvers?: { eas?: LegacyResolver; inputs?: LegacyResolver; steps?: LegacyResolver };
}): unknown {
  if (typeof target === 'string') {
    // If the value is e.g. `build: ${{ inputs.build }}`, we will interpolate the value
    // without changing `inputs.build` type, i.e. if it is an object it'll be like `build: {...inputs.build}`.
    if (isSingleWholeStringInterpolation(target)) {
      return jsepEval(target.slice(3, -2), context);
    }

    // Otherwise we replace all occurrences of `${{...}}` with the result of the expression.
    // e.g. `echo ${{ build.profile }}` becomes `echo production`.
    return interpolateTemplate(target, [
      { regex: /\$\{\{(.+?)\}\}/, resolve: expression => `${jsepEval(expression, context)}` },
      { regex: BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP, resolve: legacyResolvers.eas },
      { regex: BUILD_STEP_INPUT_EXPRESSION_REGEXP, resolve: legacyResolvers.inputs },
      { regex: BUILD_STEP_OUTPUT_EXPRESSION_REGEXP, resolve: legacyResolvers.steps },
    ]);
  } else if (Array.isArray(target)) {
    return target.map(value => interpolateJobContext({ target: value, context, legacyResolvers }));
  } else if (typeof target === 'object' && target) {
    return Object.fromEntries(
      Object.entries(target).map(([key, value]) => [
        key,
        interpolateJobContext({ target: value, context, legacyResolvers }),
      ])
    );
  }
  return target;
}
