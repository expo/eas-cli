import { BuildConfigError, BuildStepRuntimeError } from '../../errors';
import { getError } from '../../__tests__/utils/error';
import {
  findOutputPaths,
  getObjectValueForInterpolation,
  interpolateWithGlobalContext,
  interpolateWithInputs,
  interpolateWithOutputs,
  parseOutputPath,
} from '../template';

describe(interpolateWithInputs, () => {
  test('interpolation', () => {
    const result = interpolateWithInputs('foo${ inputs.foo }', { foo: 'bar' });
    expect(result).toBe('foobar');
  });
});

describe(interpolateWithOutputs, () => {
  test('interpolation', () => {
    const result = interpolateWithOutputs(
      'foo${ steps.abc123.foo }${ steps.abc123.bar }',
      (path) => {
        if (path === 'steps.abc123.foo') {
          return 'bar';
        } else if (path === 'steps.abc123.bar') {
          return 'baz';
        } else {
          return 'x';
        }
      }
    );
    expect(result).toBe('foobarbaz');
  });
});

describe(interpolateWithGlobalContext, () => {
  test('interpolation', () => {
    const result = interpolateWithGlobalContext(
      'foo${ eas.prop1.prop2.prop3.value4 }${ eas.prop1.prop2.prop3.value5 }',
      (path) => {
        if (path === 'eas.prop1.prop2.prop3.value4') {
          return 'bar';
        } else if (path === 'eas.prop1.prop2.prop3.value5') {
          return 'baz';
        } else {
          return 'x';
        }
      }
    );
    expect(result).toBe('foobarbaz');
  });
});

describe(findOutputPaths, () => {
  it('returns all occurrences of output expressions in template string', () => {
    const result = findOutputPaths('${ steps.test1.output1 }${steps.test4.output2}');
    expect(result.length).toBe(2);
    expect(result[0]).toMatchObject({
      stepId: 'test1',
      outputId: 'output1',
    });
    expect(result[1]).toMatchObject({
      stepId: 'test4',
      outputId: 'output2',
    });
  });
});

describe(parseOutputPath, () => {
  it('throws an error if path does not consist of exactly two components joined with a dot', () => {
    const error1 = getError<BuildConfigError>(() => {
      parseOutputPath('abc');
    });
    const error2 = getError<BuildConfigError>(() => {
      parseOutputPath('steps.def.ghi.jkl');
    });
    expect(error1).toBeInstanceOf(BuildConfigError);
    expect(error1.message).toMatch(/must consist of two components joined with a dot/);
    expect(error2).toBeInstanceOf(BuildConfigError);
    expect(error2.message).toMatch(/must consist of two components joined with a dot/);
  });
  it('returns an object with step ID and output ID', () => {
    const result = parseOutputPath('steps.abc.def');
    expect(result).toMatchObject({
      stepId: 'abc',
      outputId: 'def',
    });
  });
});

describe(getObjectValueForInterpolation, () => {
  it('string property', () => {
    const result = getObjectValueForInterpolation('eas.foo.bar.baz', {
      eas: {
        foo: {
          bar: {
            baz: 'qux',
          },
        },
      },
    });
    expect(result).toBe('qux');
  });

  it('number property', () => {
    const result = getObjectValueForInterpolation('eas.foo.bar.baz[0]', {
      eas: {
        foo: {
          bar: {
            baz: [1, 2, 3],
          },
        },
      },
    });
    expect(result).toBe(1);
  });

  it('boolean property', () => {
    const result = getObjectValueForInterpolation('eas.foo.bar.baz[2].qux', {
      eas: {
        foo: {
          bar: {
            baz: [
              true,
              false,
              {
                qux: true,
              },
            ],
          },
        },
      },
    });
    expect(result).toBe(true);
  });

  it('invalid property 1', () => {
    const error = getError<BuildConfigError>(() => {
      getObjectValueForInterpolation('eas.bar', {
        eas: {
          foo: {
            bar: {
              baz: [
                true,
                false,
                {
                  qux: true,
                },
              ],
            },
          },
        },
      });
    });
    expect(error).toBeInstanceOf(BuildStepRuntimeError);
    expect(error.message).toMatch(
      /Object field "eas.bar" does not exist. Ensure you are using the correct field name./
    );
  });

  it('invalid property 2', () => {
    const error = getError<BuildConfigError>(() => {
      getObjectValueForInterpolation('eas.foo.bar.baz[14].qux', {
        eas: {
          foo: {
            bar: {
              baz: [
                true,
                false,
                {
                  qux: true,
                },
              ],
            },
          },
        },
      });
    });
    expect(error).toBeInstanceOf(BuildStepRuntimeError);
    expect(error.message).toMatch(
      /Object field "eas.foo.bar.baz\[14\].qux" does not exist. Ensure you are using the correct field name./
    );
  });
});
