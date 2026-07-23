import { JobInterpolationContext } from '@expo/eas-build-job';
import { instance, mock, when } from 'ts-mockito';

import { createGlobalContextMock } from './utils/context';
import { BuildStep } from '../BuildStep';
import { BuildStepCompositeFunctionScope } from '../BuildStepCompositeFunctionScope';
import { BuildStepInput, BuildStepInputValueTypeName } from '../BuildStepInput';
import { BuildStepOutput } from '../BuildStepOutput';
import { interpolateJobContext } from '../interpolation';

describe(BuildStepCompositeFunctionScope, () => {
  const baseContext = {} as unknown as JobInterpolationContext;

  function makeScope(): BuildStepCompositeFunctionScope {
    const ctx = createGlobalContextMock();

    const versionOutput = mock<BuildStepOutput>();
    when(versionOutput.id).thenReturn('version');
    when(versionOutput.rawValue).thenReturn('1.0.0');
    const innerStep = mock<BuildStep>();
    when(innerStep.outputs).thenReturn([instance(versionOutput)]);

    const greeting = new BuildStepInput(ctx, {
      id: 'greeting',
      stepDisplayName: 'test-action',
      required: false,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    greeting.set('hello');
    return new BuildStepCompositeFunctionScope({
      ctx,
      compositeFunctionPath: 'test-action',
      inputs: new Map([['greeting', greeting]]),
      providedInputKeys: new Set(['greeting']),
      childrenByLocalId: new Map([['build', instance(innerStep)]]),
    });
  }

  it('exposes declared inputs and composite-function-local step aliases in the interpolation context', () => {
    const scope = makeScope();
    const context = scope.getScopedInterpolationContext(baseContext);
    expect(interpolateJobContext({ target: '${{ inputs.greeting }}', context })).toBe('hello');
    expect(interpolateJobContext({ target: '${{ steps.build.outputs.version }}', context })).toBe(
      '1.0.0'
    );
  });

  it('returns undefined for references outside the composite function scope', () => {
    const scope = makeScope();
    const context = scope.getScopedInterpolationContext(baseContext);
    expect(interpolateJobContext({ target: '${{ inputs.gretting }}', context })).toBeUndefined();
    expect(
      interpolateJobContext({ target: '${{ steps.checkout.outputs.sha }}', context })
    ).toBeUndefined();
  });

  describe('isActive', () => {
    const neverEvaluate = (): boolean => {
      throw new Error('a call without an if: must not evaluate an expression');
    };

    it('resolves a call without an if: with the provided run-by-default policy', () => {
      expect(makeScope().isActive(neverEvaluate, () => false)).toBe(false);
      expect(makeScope().isActive(neverEvaluate, () => true)).toBe(true);
    });

    it('memoizes the first evaluation; a later policy flip cannot re-gate the call', () => {
      const scope = makeScope();
      expect(scope.isActive(neverEvaluate, () => true)).toBe(true);
      expect(scope.isActive(neverEvaluate, () => false)).toBe(true);
    });
  });
});
