import { createStepContextMock } from '../../__tests__/utils/context';
import {
  combineIfConditions,
  createStepReferenceRewriter,
  isActionInputReference,
  mergeEnv,
  resolveActionOutputTemplate,
} from '../actionInterpolation';

describe(createStepReferenceRewriter, () => {
  it('returns an identity rewriter when the map only contains unchanged ids', () => {
    const rewrite = createStepReferenceRewriter(new Map([['a', 'a']]));
    expect(rewrite('echo "${{ steps.a.outputs.v }}"')).toBe('echo "${{ steps.a.outputs.v }}"');
  });

  it('rewrites step references to the mapped id', () => {
    const rewrite = createStepReferenceRewriter(new Map([['a', 'caller__a']]));
    expect(rewrite('echo "${{ steps.a.outputs.v }}"')).toBe(
      'echo "${{ steps.caller__a.outputs.v }}"'
    );
  });

  it('does not rewrite references embedded in longer identifiers', () => {
    const rewrite = createStepReferenceRewriter(new Map([['a', 'caller__a']]));
    expect(rewrite('mysteps.a.outputs.v ${{ steps.a.outputs.v }}')).toBe(
      'mysteps.a.outputs.v ${{ steps.caller__a.outputs.v }}'
    );
  });

  it('rewrites the longest matching id when ids share a prefix', () => {
    const rewrite = createStepReferenceRewriter(
      new Map([
        ['a', 'caller__a'],
        ['ab', 'caller__ab'],
      ])
    );
    expect(rewrite('${{ steps.a.outputs.v }} ${{ steps.ab.outputs.v }}')).toBe(
      '${{ steps.caller__a.outputs.v }} ${{ steps.caller__ab.outputs.v }}'
    );
  });
});

describe(combineIfConditions, () => {
  it('returns the own condition when there is no inherited condition', () => {
    expect(combineIfConditions(undefined, '${{ success() }}')).toBe('${{ success() }}');
  });

  it('returns the inherited condition when the step has no own condition', () => {
    expect(combineIfConditions('${{ always() }}', undefined)).toBe('${{ always() }}');
  });

  it('returns undefined when neither condition is present', () => {
    expect(combineIfConditions(undefined, undefined)).toBeUndefined();
  });

  it('combines both conditions with && while stripping the ${{ }} wrappers', () => {
    expect(combineIfConditions('${{ always() }}', '${{ success() }}')).toBe(
      '${{ (always()) && (success()) }}'
    );
  });

  it('strips a single ${ } wrapper too', () => {
    expect(combineIfConditions('${ always() }', '${ success() }')).toBe(
      '${{ (always()) && (success()) }}'
    );
  });
});

describe(mergeEnv, () => {
  it('returns undefined when both are undefined', () => {
    expect(mergeEnv(undefined, undefined)).toBeUndefined();
  });

  it('returns the base when there are no overrides', () => {
    expect(mergeEnv({ A: '1' }, undefined)).toEqual({ A: '1' });
  });

  it('returns the overrides when there is no base', () => {
    expect(mergeEnv(undefined, { A: '1' })).toEqual({ A: '1' });
  });

  it('merges with overrides taking precedence', () => {
    expect(mergeEnv({ A: '1', B: '2' }, { B: '3', C: '4' })).toEqual({ A: '1', B: '3', C: '4' });
  });
});

describe(isActionInputReference, () => {
  it('recognizes ${{ }} template references', () => {
    expect(isActionInputReference('${{ steps.a.outputs.v }}')).toBe(true);
  });

  it('returns false for plain strings and non-strings', () => {
    expect(isActionInputReference('plain')).toBe(false);
    expect(isActionInputReference(5)).toBe(false);
    expect(isActionInputReference(undefined)).toBe(false);
  });
});

describe(resolveActionOutputTemplate, () => {
  it('passes literal templates through unchanged', () => {
    const stepCtx = createStepContextMock();
    expect(resolveActionOutputTemplate('literal', stepCtx, {})).toBe('literal');
  });

  it('resolves env references against the provided env', () => {
    const stepCtx = createStepContextMock();
    expect(resolveActionOutputTemplate('${{ env.FOO }}', stepCtx, { FOO: 'bar' })).toBe('bar');
  });
});
