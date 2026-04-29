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
    // If the value is exactly one `${{ ... }}` expression, we interpolate it without
    // changing the result's type, i.e. if `inputs.build` is an object then
    // `build: ${{ inputs.build }}` becomes `build: {...inputs.build}`.
    //
    // `startsWith('${{') && endsWith('}}')` alone is not enough: a value like
    // `${{ a }}: ${{ b }}` also starts with `${{` and ends with `}}`, but those
    // delimiters are not a matched pair. We must also confirm there's no second
    // `${{` after the opening one.
    if (
      target.startsWith('${{') &&
      target.endsWith('}}') &&
      target.indexOf('${{', 3) === -1
    ) {
      return jsepEval(target.slice(3, -2), context);
    }

    // Otherwise we replace all occurrences of `${{...}}` with the result of the expression.
    // e.g. `echo ${{ build.profile }}` becomes `echo production`.
    return target.replace(/\$\{\{(.+?)\}\}/g, (_match, expression) => {
      return `${jsepEval(expression, context)}`;
    });
  } else if (Array.isArray(target)) {
    return target.map(value => interpolateJobContext({ target: value, context }));
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
