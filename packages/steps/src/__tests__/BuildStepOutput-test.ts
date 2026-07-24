import { createGlobalContextMock } from './utils/context';
import { BuildStep } from '../BuildStep';
import { BuildStepOutput, makeBuildStepOutputById } from '../BuildStepOutput';
import { BuildStepRuntimeError } from '../errors';

describe(BuildStepOutput, () => {
  test('basic case', () => {
    const ctx = createGlobalContextMock();
    const o = new BuildStepOutput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
    });
    o.set('bar');
    expect(o.value).toBe('bar');
  });

  test('enforces required policy when reading value', () => {
    const ctx = createGlobalContextMock();
    const o = new BuildStepOutput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
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
      stepDisplayName: 'test1',
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
      stepDisplayName: 'test1',
      required: true,
    });
    o.set('bar');
    expect(o.serialize()).toEqual({
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      value: 'bar',
    });
  });

  test('deserializes correctly', () => {
    const o = BuildStepOutput.deserialize({
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      value: 'bar',
    });
    expect(o.id).toBe('foo');
    expect(o.stepDisplayName).toBe('test1');
    expect(o.required).toBe(true);
    expect(o.value).toBe('bar');
  });
});

describe(makeBuildStepOutputById, () => {
  it('returns an empty null-prototype object when outputs are undefined', () => {
    const result = makeBuildStepOutputById(undefined);

    expect(Object.keys(result)).toEqual([]);
    expect(Object.getPrototypeOf(result)).toBeNull();
  });

  it('returns a null-prototype object with outputs indexed by their ids', () => {
    const ctx = createGlobalContextMock();
    const outputs: BuildStepOutput[] = [
      new BuildStepOutput(ctx, {
        id: 'abc1',
        stepDisplayName: 'test1',
        required: true,
      }),
      new BuildStepOutput(ctx, {
        id: 'abc2',
        stepDisplayName: 'test1',
        required: true,
      }),
    ];
    const result = makeBuildStepOutputById(outputs);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.abc1).toBeDefined();
    expect(result.abc2).toBeDefined();
  });

  it('supports output ids that are special object property names', () => {
    const ctx = createGlobalContextMock();
    const output = new BuildStepOutput(ctx, {
      id: '__proto__',
      stepDisplayName: 'test1',
      required: true,
    });

    const result = makeBuildStepOutputById([output]);

    expect(result.__proto__).toBe(output);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
  });
});
