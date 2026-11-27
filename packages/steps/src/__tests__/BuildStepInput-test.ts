import { JobInterpolationContext } from '@expo/eas-build-job';
import { jest } from '@jest/globals';

import { createGlobalContextMock } from './utils/context';
import { BuildStep } from '../BuildStep';
import { BuildStepGlobalContext } from '../BuildStepContext';
import {
  BuildStepInput,
  BuildStepInputValueTypeName,
  makeBuildStepInputByIdMap,
} from '../BuildStepInput';
import { BuildStepRuntimeError } from '../errors';

describe(BuildStepInput, () => {
  test('basic case string', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    i.set('bar');
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe('bar');
  });

  test('basic case boolean', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      required: true,
    });
    i.set(false);
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(false);
  });

  test('basic case number', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      required: true,
    });
    i.set(42);
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(42);
  });

  test('basic case json', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      required: true,
    });
    i.set({ foo: 'bar' });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
      foo: 'bar',
    });
  });

  test('basic case undefined', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: false,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    i.set(undefined);
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBeUndefined();
  });

  test('default value string', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: 'baz',
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe('baz');
  });

  test('default value boolean', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: true,
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(true);
  });

  test('default value json', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: { foo: 'bar' },
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
      foo: 'bar',
    });
  });

  test('context value string', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.runtimePlatform }',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual('linux');
  });

  test('context value string', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: 'bar',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo }}',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual('bar');
  });

  test('context value string', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: 'bar',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: 'test-${{ foo }}',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual('test-bar');
  });

  test('context value string', () => {
    const ctx = createGlobalContextMock();
    ctx.updateEnv({
      HOME: '/home/test',
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.env.HOME }',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(
      '/home/test'
    );
  });

  test('context value string with newline characters', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: 'Line 1\nLine 2\n\nLine 3',
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar }',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(
      'Line 1\nLine 2\n\nLine 3'
    );
  });

  test('context value string with newline characters', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: 'Line 1\nLine 2\n\nLine 3',
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar }}',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(
      'Line 1\nLine 2\n\nLine 3'
    );
  });

  test('context value string with doubly escaped newline characters', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: 'Line 1\\nLine 2\\n\\nLine 3',
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar }',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(
      'Line 1\nLine 2\n\nLine 3'
    );
  });

  test('context value string with doubly escaped newline characters', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: 'Line 1\\nLine 2\\n\\nLine 3',
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar }}',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(
      'Line 1\nLine 2\n\nLine 3'
    );
  });

  test('context value number', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: 42,
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar[3].baz }',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(42);
  });

  test('context value number', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: 42,
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar[3].baz }}',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(42);
  });

  test('context value number', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: 42,
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: 'test-${{ foo.bar[3].baz }}',
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual('test-42');
  });

  test('context value boolean', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: false,
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar[3].baz.qux }',
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(false);
  });

  test('context value boolean', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 'test-123',
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ startsWith(foo.bar[3].baz.qux, "test") }}',
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(true);
  });

  test('context value boolean', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: false,
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar[3].baz.qux }}',
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(false);
  });

  test('context value JSON', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: false,
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo }',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toMatchObject({
      bar: [1, 2, 3, { baz: { qux: false } }],
    });
  });

  test('context value JSON', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: false,
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo }}',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toMatchObject({
      bar: [1, 2, 3, { baz: { qux: false } }],
    });
  });

  test('invalid context value type number', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 'ala ma kota',
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar[3].baz.qux }',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      required: true,
    });
    expect(() => i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toThrowError(
      'Input parameter "foo" for step "test1" must be of type "number".'
    );
  });

  test('invalid context value type number', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 'ala ma kota',
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar[3].baz.qux }}',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      required: true,
    });
    expect(() => i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toThrowError(
      'Input parameter "foo" for step "test1" must be of type "number".'
    );
  });

  test('invalid context value type boolean', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 123,
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar[3].baz.qux }',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
    });
    expect(() => i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toThrowError(
      'Input parameter "foo" for step "test1" must be of type "boolean".'
    );
  });

  test('invalid context value type boolean', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 123,
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar[3].baz.qux }}',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
    });
    expect(() => i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toThrowError(
      'Input parameter "foo" for step "test1" must be of type "boolean".'
    );
  });

  test('invalid context value type JSON', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 'ala ma kota',
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${ eas.foo.bar[3].baz.qux }',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      required: true,
    });
    expect(() => i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toThrowError(
      'Input parameter "foo" for step "test1" must be of type "json".'
    );
  });

  test('invalid context value type JSON', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: {
          bar: [
            1,
            2,
            3,
            {
              baz: {
                qux: 'ala ma kota',
              },
            },
          ],
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: '${{ foo.bar[3].baz.qux }}',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      required: true,
    });
    expect(() => i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toThrowError(
      'Input parameter "foo" for step "test1" must be of type "json".'
    );
  });

  test('context values in an object', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        context_val_1: 'val_1',
        context_val_2: {
          in_val_1: 'in_val_1',
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
    });
    i.set({
      foo: 'foo',
      bar: '${ eas.context_val_1 }',
      baz: {
        bazfoo: 'bazfoo',
        bazbar: '${ eas.context_val_2.in_val_1 }',
        bazbaz: ['bazbaz', '${ eas.context_val_1 }', '${ eas.context_val_2.in_val_1 }'],
      },
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
      foo: 'foo',
      bar: 'val_1',
      baz: {
        bazfoo: 'bazfoo',
        bazbar: 'in_val_1',
        bazbaz: ['bazbaz', 'val_1', 'in_val_1'],
      },
    });
  });

  test('context values in an object', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        context_val_1: 'val_1',
        context_val_2: {
          in_val_1: 'in_val_1',
        },
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
    });
    i.set({
      foo: 'foo',
      bar: '${{ context_val_1 }}',
      baz: {
        bazfoo: 'bazfoo',
        bazbar: '${{ context_val_2.in_val_1 }}',
        bazbaz: ['bazbaz', '${{ context_val_1 }}', '${{ context_val_2.in_val_1 }}'],
      },
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
      foo: 'foo',
      bar: 'val_1',
      baz: {
        bazfoo: 'bazfoo',
        bazbar: 'in_val_1',
        bazbaz: ['bazbaz', 'val_1', 'in_val_1'],
      },
    });
  });

  test('context values in an object with newline characters', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        context_val_1: 'Line 1\nLine 2\n\nLine 3',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
    });
    i.set({
      foo: 'foo',
      bar: '${ eas.context_val_1 }',
      baz: {
        bazfoo: 'bazfoo',
        bazbaz: ['bazbaz', '${ eas.context_val_1 }'],
      },
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
      foo: 'foo',
      bar: 'Line 1\nLine 2\n\nLine 3',
      baz: {
        bazfoo: 'bazfoo',
        bazbaz: ['bazbaz', 'Line 1\nLine 2\n\nLine 3'],
      },
    });
  });

  test('context values in an object with newline characters', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        context_val_1: 'Line 1\nLine 2\n\nLine 3',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
    });
    i.set({
      foo: 'foo',
      bar: '${{ context_val_1 }}',
      baz: {
        bazfoo: 'bazfoo',
        bazbaz: ['bazbaz', '${{ context_val_1 }}'],
      },
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
      foo: 'foo',
      bar: 'Line 1\nLine 2\n\nLine 3',
      baz: {
        bazfoo: 'bazfoo',
        bazbaz: ['bazbaz', 'Line 1\nLine 2\n\nLine 3'],
      },
    });
  });

  test('default value number', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      defaultValue: 42,
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
      required: true,
    });
    expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(42);
  });

  test('enforces required policy when reading value', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError(
      new BuildStepRuntimeError(
        'Input parameter "foo" for step "test1" is required but it was not set.'
      )
    );
  });

  test('enforces correct value type when reading a value - basic', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
    });
    i.set('bar');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError(
      new BuildStepRuntimeError('Input parameter "foo" for step "test1" must be of type "boolean".')
    );
  });

  test('enforces correct value type when reading a value - reference json', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      required: true,
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
    });
    i.set('${ eas.runtimePlatform }');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError('Input parameter "foo" for step "test1" must be of type "json".');
  });

  test('enforces correct value type when reading a value - reference json', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: 'bar',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      required: true,
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.JSON,
    });
    i.set('${{ foo }}');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError('Input parameter "foo" for step "test1" must be of type "json".');
  });

  test('enforces correct value type when reading a value - reference number', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      required: true,
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
    });
    i.set('${ eas.runtimePlatform }');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError(
      new BuildStepRuntimeError('Input parameter "foo" for step "test1" must be of type "number".')
    );
  });

  test('enforces correct value type when reading a value - reference number', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: 'bar',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      required: true,
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.NUMBER,
    });
    i.set('${{ foo }}');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError(
      new BuildStepRuntimeError('Input parameter "foo" for step "test1" must be of type "number".')
    );
  });

  test('enforces correct value type when reading a value - reference boolean', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      required: true,
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
    });
    i.set('${ eas.runtimePlatform }');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError(
      new BuildStepRuntimeError('Input parameter "foo" for step "test1" must be of type "boolean".')
    );
  });

  test('enforces correct value type when reading a value - reference boolean', () => {
    const ctx = createGlobalContextMock({
      staticContextContent: {
        foo: 'bar',
      } as unknown as JobInterpolationContext,
    });
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      required: true,
      stepDisplayName: 'test1',
      allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
    });
    i.set('${{ foo }}');
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      i.getValue({ interpolationContext: ctx.getInterpolationContext() });
    }).toThrowError(
      new BuildStepRuntimeError('Input parameter "foo" for step "test1" must be of type "boolean".')
    );
  });

  test('enforces required policy when setting value', () => {
    const ctx = createGlobalContextMock();
    const i = new BuildStepInput<BuildStepInputValueTypeName>(ctx, {
      id: 'foo',
      stepDisplayName: 'test1',
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
    expect(() => {
      i.set(undefined);
    }).toThrowError(
      new BuildStepRuntimeError('Input parameter "foo" for step "test1" is required.')
    );
  });

  describe('placeholders inside interpolated values', () => {
    function createStringInput(ctx: BuildStepGlobalContext, value: unknown): BuildStepInput {
      return new BuildStepInput(ctx, {
        id: 'foo',
        stepDisplayName: 'test1',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }).set(value);
    }

    it('does not interpolate ${ eas.* } that a ${{ }} value contains', () => {
      const commentBody = 'Hello ${ eas.job.secrets.robotAccessToken }';
      const ctx = createGlobalContextMock({
        staticContextContent: {
          github: { event: { comment: { body: commentBody } } },
          job: { secrets: { robotAccessToken: 'secret-token' } },
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, 'User said: ${{ github.event.comment.body }}');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
        `User said: ${commentBody}`
      );
    });

    it('does not interpolate ${ eas.* } that a whole-value ${{ }} string contains', () => {
      const commentBody = 'Hello ${ eas.job.secrets.robotAccessToken }';
      const ctx = createGlobalContextMock({
        staticContextContent: {
          github: { event: { comment: { body: commentBody } } },
          job: { secrets: { robotAccessToken: 'secret-token' } },
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, '${{ github.event.comment.body }}');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(commentBody);
    });

    it('does not fail on unknown ${ eas.* } or ${ steps.* } that a ${{ }} value contains', () => {
      const message = 'Document ${ eas.foo } and ${ steps.build.id }';
      const ctx = createGlobalContextMock({
        staticContextContent: {
          github: { event: { head_commit: { message } } },
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, 'Commit: ${{ github.event.head_commit.message }}');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
        `Commit: ${message}`
      );
    });

    it('does not interpolate strings nested in a whole-value ${{ }} object', () => {
      const event = {
        comment: { body: 'Hello ${ eas.job.secrets.robotAccessToken }' },
        labels: ['${ steps.build.id }'],
      };
      const ctx = createGlobalContextMock({
        staticContextContent: {
          github: { event },
          job: { secrets: { robotAccessToken: 'secret-token' } },
        } as unknown as JobInterpolationContext,
      });
      const i = new BuildStepInput(ctx, {
        id: 'foo',
        stepDisplayName: 'test1',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }).set('${{ github.event }}');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual(event);
    });

    it('returns a copy of the object that a whole-value ${{ }} evaluates to', () => {
      const event = { comment: { body: 'Hello' } };
      const ctx = createGlobalContextMock({
        staticContextContent: {
          github: { event },
        } as unknown as JobInterpolationContext,
      });
      const i = new BuildStepInput(ctx, {
        id: 'foo',
        stepDisplayName: 'test1',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }).set('${{ github.event }}');
      const value = i.getValue({ interpolationContext: ctx.getInterpolationContext() }) as any;
      expect(value).toEqual(event);
      expect(value).not.toBe(event);
      expect(value.comment).not.toBe(event.comment);
    });

    it('does not interpolate ${ steps.* } that a ${ eas.* } value contains', () => {
      const ctx = createGlobalContextMock({
        staticContextContent: {
          title: 'See ${ steps.build.id }',
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, 'Title: ${ eas.title }');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
        'Title: See ${ steps.build.id }'
      );
    });

    it('inserts values that contain $ replacement patterns verbatim', () => {
      const ctx = createGlobalContextMock({
        staticContextContent: {
          price: "$$5 $& $1 $` $'",
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, 'Price: ${ eas.price }, again: ${{ price }}');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
        "Price: $$5 $& $1 $` $', again: $$5 $& $1 $` $'"
      );
    });

    it('replaces each placeholder at its own position', () => {
      const ctx = createGlobalContextMock({
        staticContextContent: {
          first: '${ eas.second }',
          second: 'two',
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, '${ eas.first } ${ eas.second }');
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
        '${ eas.second } two'
      );
    });

    it('interpolates both syntaxes that the author mixes in one string', () => {
      const ctx = createGlobalContextMock({
        staticContextContent: {
          foo: 'bar',
        } as unknown as JobInterpolationContext,
      });
      jest.spyOn(ctx, 'getStepOutputValue').mockReturnValue('output');
      const i = createStringInput(
        ctx,
        '${{ foo }} ${ eas.runtimePlatform } ${ steps.build.id } ${{ foo }}${ eas.foo }'
      );
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
        'bar linux output barbar'
      );
      expect(ctx.getStepOutputValue).toHaveBeenCalledWith('steps.build.id');
    });

    it('interpolates both syntaxes in strings nested in an object the author wrote', () => {
      const ctx = createGlobalContextMock({
        staticContextContent: {
          foo: 'bar',
          count: 3,
        } as unknown as JobInterpolationContext,
      });
      jest.spyOn(ctx, 'getStepOutputValue').mockReturnValue('output');
      const i = new BuildStepInput(ctx, {
        id: 'foo',
        stepDisplayName: 'test1',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }).set({
        mixed: '${{ foo }}-${ eas.runtimePlatform }',
        typed: '${{ count }}',
        list: ['${ steps.build.id }', 1],
      });
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
        mixed: 'bar-linux',
        typed: 3,
        list: ['output', 1],
      });
    });

    it('keeps null nested in an object the author wrote', () => {
      const ctx = createGlobalContextMock();
      const i = new BuildStepInput(ctx, {
        id: 'foo',
        stepDisplayName: 'test1',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }).set({ foo: null, bar: [null, '${ eas.runtimePlatform }'] });
      expect(i.getValue({ interpolationContext: ctx.getInterpolationContext() })).toEqual({
        foo: null,
        bar: [null, 'linux'],
      });
    });

    it('keeps ${ steps.* } literal and interpolates ${ eas.* } for composite function inputs', () => {
      const ctx = createGlobalContextMock({
        staticContextContent: {
          foo: 'bar',
        } as unknown as JobInterpolationContext,
      });
      const i = createStringInput(ctx, '${{ foo }} ${ eas.runtimePlatform } ${ steps.build.id }');
      expect(
        i.getValue({
          interpolationContext: ctx.getInterpolationContext(),
          skipLegacyOutputInterpolation: true,
        })
      ).toBe('bar linux ${ steps.build.id }');
    });
  });
});

describe(makeBuildStepInputByIdMap, () => {
  it('returns empty object when inputs are undefined', () => {
    expect(makeBuildStepInputByIdMap(undefined)).toEqual({});
  });

  it('returns object with inputs indexed by their ids', () => {
    const ctx = createGlobalContextMock();
    const inputs: BuildStepInput[] = [
      new BuildStepInput(ctx, {
        id: 'foo1',
        stepDisplayName: 'test1',
        defaultValue: 'bar1',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      new BuildStepInput(ctx, {
        id: 'foo2',
        stepDisplayName: 'test1',
        defaultValue: 'bar2',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      new BuildStepInput(ctx, {
        id: 'foo3',
        stepDisplayName: 'test1',
        defaultValue: true,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        required: true,
      }),
    ];
    const result = makeBuildStepInputByIdMap(inputs);
    expect(Object.keys(result).length).toBe(3);
    expect(result.foo1).toBeDefined();
    expect(result.foo2).toBeDefined();
    expect(result.foo1.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
      'bar1'
    );
    expect(result.foo2.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
      'bar2'
    );
    expect(result.foo3.getValue({ interpolationContext: ctx.getInterpolationContext() })).toBe(
      true
    );
  });
});
