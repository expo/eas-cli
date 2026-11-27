import { jest } from '@jest/globals';

import { getError } from '../../__tests__/utils/error';
import { BuildConfigError, BuildStepRuntimeError } from '../../errors';
import {
  BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP,
  BUILD_STEP_INPUT_EXPRESSION_REGEXP,
  BUILD_STEP_OUTPUT_EXPRESSION_REGEXP,
  findOutputPaths,
  getObjectValueForInterpolation,
  interpolateTemplate,
  interpolateWithGlobalContext,
  parseOutputPath,
} from '../template';

describe(interpolateTemplate, () => {
  it('interpolates inputs', () => {
    const result = interpolateTemplate('foo${ inputs.foo }', [
      { regex: BUILD_STEP_INPUT_EXPRESSION_REGEXP, resolve: path => `<${path}>` },
    ]);
    expect(result).toBe('foo<inputs.foo>');
  });

  it('interpolates outputs', () => {
    const result = interpolateTemplate('foo${ steps.abc123.foo }${ steps.abc123.bar }', [
      {
        regex: BUILD_STEP_OUTPUT_EXPRESSION_REGEXP,
        resolve: path => {
          if (path === 'steps.abc123.foo') {
            return 'bar';
          } else if (path === 'steps.abc123.bar') {
            return 'baz';
          } else {
            return 'x';
          }
        },
      },
    ]);
    expect(result).toBe('foobarbaz');
  });

  it('returns the template when nothing matches', () => {
    expect(
      interpolateTemplate('foo ${ bar }', [
        { regex: BUILD_STEP_OUTPUT_EXPRESSION_REGEXP, resolve: () => 'x' },
      ])
    ).toBe('foo ${ bar }');
    expect(interpolateTemplate('foo ${ steps.a.b }', [])).toBe('foo ${ steps.a.b }');
  });

  it('applies all interpolations to the text of the template', () => {
    const result = interpolateTemplate('${ steps.a.b }-${ eas.a }-${ inputs.a }-${ eas.b }', [
      { regex: BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP, resolve: path => `<${path}>` },
      { regex: BUILD_STEP_INPUT_EXPRESSION_REGEXP, resolve: path => `<${path}>` },
      { regex: BUILD_STEP_OUTPUT_EXPRESSION_REGEXP, resolve: path => `<${path}>` },
    ]);
    expect(result).toBe('<steps.a.b>-<eas.a>-<inputs.a>-<eas.b>');
  });

  it('does not scan a value that an earlier interpolation inserted', () => {
    const resolve = jest.fn((path: string) =>
      path === 'eas.a' ? '${ steps.a.b } ${ eas.b } ${ inputs.a }' : 'x'
    );
    const result = interpolateTemplate('${ eas.a }|${ steps.c.d }', [
      { regex: BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP, resolve },
      { regex: BUILD_STEP_INPUT_EXPRESSION_REGEXP, resolve },
      { regex: BUILD_STEP_OUTPUT_EXPRESSION_REGEXP, resolve },
    ]);
    expect(result).toBe('${ steps.a.b } ${ eas.b } ${ inputs.a }|x');
    expect(resolve.mock.calls).toEqual([['eas.a'], ['steps.c.d']]);
  });

  it('does not match a placeholder that spans the template and an inserted value', () => {
    const result = interpolateTemplate('${ eas.a${ inputs.a }', [
      { regex: BUILD_STEP_INPUT_EXPRESSION_REGEXP, resolve: () => '.b }' },
      { regex: BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP, resolve: () => 'x' },
    ]);
    expect(result).toBe('${ eas.a.b }');
  });

  it('inserts values that contain $ replacement patterns verbatim', () => {
    const result = interpolateTemplate('a ${ eas.a } b', [
      { regex: BUILD_GLOBAL_CONTEXT_EXPRESSION_REGEXP, resolve: () => "$$ $& $1 $` $'" },
    ]);
    expect(result).toBe("a $$ $& $1 $` $' b");
  });
});

describe(interpolateWithGlobalContext, () => {
  test('interpolation', () => {
    const result = interpolateWithGlobalContext(
      'foo${ eas.prop1.prop2.prop3.value4 }${ eas.prop1.prop2.prop3.value5 }',
      path => {
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
