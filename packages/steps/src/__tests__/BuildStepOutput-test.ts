import { BuildStep } from '../BuildStep';
import { BuildStepOutput, makeBuildStepOutputByIdMap } from '../BuildStepOutput';
import { BuildStepRuntimeError } from '../errors';

import { createGlobalContextMock } from './utils/context';

describe(BuildStepOutput, () => {
  test('basic case', () => {
    const ctx = createGlobalContextMock();
    const o = new BuildStepOutput(ctx, {
      id: 'foo',
      stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
      required: true,
    });
    o.set('bar');
    expect(o.value).toBe('bar');
  });

  test('enforces required policy when reading value', () => {
    const ctx = createGlobalContextMock();
    const o = new BuildStepOutput(ctx, {
      id: 'foo',
      stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
      required: true,
    });
    expect(() => {
      // eslint-disable-next-line
      o.value;
    }).toThrowError(
      new BuildStepRuntimeError(
        'Output parameter "foo" for step "test1" is required but it was not set.'
      )
    );
  });

  test('enforces required policy when setting value', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepOutput<boolean>(ctx, {
      id: 'foo',
      stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
      required: true,
    });
    expect(() => {
      i.set(undefined);
    }).toThrowError(
      new BuildStepRuntimeError('Output parameter "foo" for step "test1" is required.')
    );
  });

  test('serializes correctly', () => {
    const ctx = createGlobalContextMock();
    const o = new BuildStepOutput(ctx, {
      id: 'foo',
      stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
      required: true,
    });
    o.set('bar');
    expect(o.serialize()).toEqual({
      id: 'foo',
      stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
      required: true,
      value: 'bar',
    });
  });

  test('deserializes correctly', () => {
    const o = BuildStepOutput.deserialize({
      id: 'foo',
      stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
      required: true,
      value: 'bar',
    });
    expect(o.id).toBe('foo');
    expect(o.stepDisplayName).toBe(BuildStep.getDisplayName({ id: 'test1' }));
    expect(o.required).toBe(true);
    expect(o.value).toBe('bar');
  });
});

describe(makeBuildStepOutputByIdMap, () => {
  it('returns empty object when inputs are undefined', () => {
    expect(makeBuildStepOutputByIdMap(undefined)).toEqual({});
  });

  it('returns object with outputs indexed by their ids', () => {
    const ctx = createGlobalContextMock();
    const outputs: BuildStepOutput[] = [
      new BuildStepOutput(ctx, {
        id: 'abc1',
        stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
        required: true,
      }),
      new BuildStepOutput(ctx, {
        id: 'abc2',
        stepDisplayName: BuildStep.getDisplayName({ id: 'test1' }),
        required: true,
      }),
    ];
    const result = makeBuildStepOutputByIdMap(outputs);
    expect(Object.keys(result).length).toBe(2);
    expect(result.abc1).toBeDefined();
    expect(result.abc2).toBeDefined();
  });
});
