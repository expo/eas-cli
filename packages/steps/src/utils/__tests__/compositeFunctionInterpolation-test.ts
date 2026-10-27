import { JobInterpolationContext } from '@expo/eas-build-job';

import { createGlobalContextMock } from '../../__tests__/utils/context';
import {
  containsUnresolvedTemplateReference,
  resolveInterpolatedTarget,
  stringifyInterpolatedResult,
} from '../compositeFunctionInterpolation';

function contextWith({
  steps = {},
  env = {},
}: {
  steps?: JobInterpolationContext['steps'];
  env?: Record<string, string | undefined>;
} = {}): JobInterpolationContext {
  const globalCtx = createGlobalContextMock();
  return { ...globalCtx.getInterpolationContext(), steps, env } as JobInterpolationContext;
}

describe(resolveInterpolatedTarget, () => {
  it('passes literal targets through unchanged', () => {
    expect(resolveInterpolatedTarget('literal', contextWith())).toBe('literal');
  });

  it('resolves ${{ }} expressions against the context', () => {
    expect(resolveInterpolatedTarget('${{ env.FOO }}', contextWith({ env: { FOO: 'bar' } }))).toBe(
      'bar'
    );
  });

  it('leaves legacy ${ steps.* } references untouched', () => {
    expect(resolveInterpolatedTarget('v${ steps.read.version }', contextWith())).toBe(
      'v${ steps.read.version }'
    );
  });

  it('returns non-string results as-is', () => {
    expect(resolveInterpolatedTarget('${{ fromJSON(\'{"a":1}\') }}', contextWith())).toEqual({
      a: 1,
    });
  });
});

describe(stringifyInterpolatedResult, () => {
  it('renders nullish values as an empty string and objects as JSON', () => {
    expect(stringifyInterpolatedResult(undefined)).toBe('');
    expect(stringifyInterpolatedResult(null)).toBe('');
    expect(stringifyInterpolatedResult({ a: 1 })).toBe('{"a":1}');
    expect(stringifyInterpolatedResult(3)).toBe('3');
  });
});

describe(containsUnresolvedTemplateReference, () => {
  it('recognizes ${{ }} template references', () => {
    expect(containsUnresolvedTemplateReference('${{ steps.a.outputs.v }}')).toBe(true);
    expect(containsUnresolvedTemplateReference(' ${{ steps.a.outputs.v }} ')).toBe(true);
    expect(containsUnresolvedTemplateReference('${{ steps.a.outputs.v }}\n')).toBe(true);
  });

  it('recognizes ${{ }} template references embedded in a larger string', () => {
    expect(containsUnresolvedTemplateReference('${{ steps.a.outputs.v }}px')).toBe(true);
    expect(containsUnresolvedTemplateReference('${{ inputs.p }}-variant')).toBe(true);
    expect(containsUnresolvedTemplateReference('a-${{ env.FOO }}-b')).toBe(true);
  });

  it('does not recognize legacy ${ } spans, which are unsupported inside actions', () => {
    expect(containsUnresolvedTemplateReference('${ steps.a.outputs.v }')).toBe(false);
    expect(containsUnresolvedTemplateReference('${ steps.a.v }')).toBe(false);
    expect(containsUnresolvedTemplateReference('a-${ steps.a.outputs.v }-b')).toBe(false);
    expect(containsUnresolvedTemplateReference('${ inputs.count }')).toBe(false);
    expect(containsUnresolvedTemplateReference('echo ${FOO:-bar}')).toBe(false);
  });

  it('returns false for plain strings and non-strings', () => {
    expect(containsUnresolvedTemplateReference('plain')).toBe(false);
    expect(containsUnresolvedTemplateReference(5)).toBe(false);
    expect(containsUnresolvedTemplateReference(undefined)).toBe(false);
  });
});
