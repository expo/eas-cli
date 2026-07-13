import { JobInterpolationContext } from '@expo/eas-build-job';

import { createGlobalContextMock } from '../../__tests__/utils/context';
import {
  containsUnresolvedTemplateReference,
  resolveInterpolatedTarget,
  stringifyInterpolatedResult,
} from '../actionInterpolation';

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
  const neverResolve = (): string => '';

  it('passes literal targets through unchanged', () => {
    expect(resolveInterpolatedTarget('literal', contextWith(), neverResolve)).toBe('literal');
  });

  it('resolves ${{ }} expressions against the context', () => {
    expect(
      resolveInterpolatedTarget(
        '${{ env.FOO }}',
        contextWith({ env: { FOO: 'bar' } }),
        neverResolve
      )
    ).toBe('bar');
  });

  it('routes legacy ${ steps.* } references through the provided resolver', () => {
    const resolver = (path: string): string => (path === 'steps.read.version' ? '1.2.3' : '');
    expect(resolveInterpolatedTarget('v${ steps.read.version }', contextWith(), resolver)).toBe(
      'v1.2.3'
    );
  });

  it('returns non-string results as-is, without touching the legacy resolver', () => {
    const context = contextWith();
    const resolver = jest.fn<string, [string]>();
    expect(resolveInterpolatedTarget('${{ fromJSON(\'{"a":1}\') }}', context, resolver)).toEqual({
      a: 1,
    });
    expect(resolver).not.toHaveBeenCalled();
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

  it('recognizes legacy ${ } step output references', () => {
    expect(containsUnresolvedTemplateReference('${ steps.a.outputs.v }')).toBe(true);
    expect(containsUnresolvedTemplateReference('${ steps.a.v }')).toBe(true);
    expect(containsUnresolvedTemplateReference('a-${ steps.a.outputs.v }-b')).toBe(true);
  });

  it('does not recognize non-step legacy ${ } spans', () => {
    expect(containsUnresolvedTemplateReference('${ inputs.count }')).toBe(false);
    expect(containsUnresolvedTemplateReference('echo ${FOO:-bar}')).toBe(false);
  });

  it('returns false for plain strings and non-strings', () => {
    expect(containsUnresolvedTemplateReference('plain')).toBe(false);
    expect(containsUnresolvedTemplateReference(5)).toBe(false);
    expect(containsUnresolvedTemplateReference(undefined)).toBe(false);
  });
});
