import { deserializeInputs, serializeInputs } from '../customFunction.js';

describe(serializeInputs, () => {
  test('serializes inputs correctly', () => {
    const inputs = {
      foo: { value: 'bar' },
      baz: { value: 123 },
      qux: { value: true },
      quux: { value: { foo: 'bar' } },
      quuux: { value: ['foo', 'bar'] },
      quuuux: { value: null },
    };
    const serializedInputs = serializeInputs(inputs);
    expect(serializedInputs).toEqual({
      foo: { serializedValue: '"bar"' },
      baz: { serializedValue: '123' },
      qux: { serializedValue: 'true' },
      quux: { serializedValue: '{"foo":"bar"}' },
      quuux: { serializedValue: '["foo","bar"]' },
      quuuux: { serializedValue: 'null' },
    });
  });
});

describe(deserializeInputs, () => {
  test('deserializes inputs correctly', () => {
    const inputs = deserializeInputs({
      foo: { serializedValue: '"bar"' },
      baz: { serializedValue: '123' },
      qux: { serializedValue: 'true' },
      quux: { serializedValue: '{"foo":"bar"}' },
      quuux: { serializedValue: '["foo","bar"]' },
      quuuux: { serializedValue: 'null' },
    });
    expect(inputs).toEqual({
      foo: { value: 'bar' },
      baz: { value: 123 },
      qux: { value: true },
      quux: { value: { foo: 'bar' } },
      quuux: { value: ['foo', 'bar'] },
      quuuux: { value: null },
    });
  });
});
