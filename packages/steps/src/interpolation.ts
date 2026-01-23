import { JobInterpolationContext } from '@expo/eas-build-job';

import { jsepEval } from './utils/jsepEval';

export function interpolateJobContext({
  target,
  context,
}: {
  target: unknown;
  context: JobInterpolationContext;
}): unknown {
  if (typeof target === 'string') {
    // If the value is e.g. `build: ${{ inputs.build }}`, we will interpolate the value
    // without changing `inputs.build` type, i.e. if it is an object it'll be like `build: {...inputs.build}`.
    if (target.startsWith('${{') && target.endsWith('}}')) {
      return jsepEval(target.slice(3, -2), context);
    }

    // Otherwise we replace all occurrences of `${{...}}` with the result of the expression.
    // e.g. `echo ${{ build.profile }}` becomes `echo production`.
    return target.replace(/\$\{\{(.+?)\}\}/g, (_match, expression) => {
      return `${jsepEval(expression, context)}`;
    });
  } else if (Array.isArray(target)) {
    return target.map((value) => interpolateJobContext({ target: value, context }));
  } else if (typeof target === 'object' && target) {
    return Object.fromEntries(
      Object.entries(target).map(([key, value]) => [
        key,
        interpolateJobContext({ target: value, context }),
      ])
    );
  }
  return target;
}
