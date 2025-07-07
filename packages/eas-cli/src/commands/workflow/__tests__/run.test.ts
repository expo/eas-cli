import { parseInputs, parseJsonInputs } from '../run';

describe('parseInputs', () => {
  it('should parse single key=value pair', () => {
    const inputs = parseInputs(['key=value']);
    expect(inputs).toEqual({ key: 'value' });
  });

  it('should parse multiple key=value pairs', () => {
    const inputs = parseInputs(['key1=value1', 'key2=value2', 'key3=value3']);
    expect(inputs).toEqual({
      key1: 'value1',
      key2: 'value2',
      key3: 'value3',
    });
  });

  it('should handle empty value', () => {
    const inputs = parseInputs(['key=']);
    expect(inputs).toEqual({ key: '' });
  });

  it('should handle values with equals signs', () => {
    const inputs = parseInputs(['key=value=with=equals']);
    expect(inputs).toEqual({ key: 'value=with=equals' });
  });

  it('should handle values with spaces', () => {
    const inputs = parseInputs(['key=value with spaces']);
    expect(inputs).toEqual({ key: 'value with spaces' });
  });

  it('should handle special characters in values', () => {
    const inputs = parseInputs(['key=value!@#$%^&*()']);
    expect(inputs).toEqual({ key: 'value!@#$%^&*()' });
  });

  it('should throw error for invalid format without equals', () => {
    expect(() => parseInputs(['invalid_format'])).toThrow(
      'Invalid input format: invalid_format. Expected key=value format.'
    );
  });

  it('should throw error for empty key', () => {
    expect(() => parseInputs(['=value'])).toThrow(
      'Invalid input format: =value. Key cannot be empty.'
    );
  });

  it('should handle empty array', () => {
    const inputs = parseInputs([]);
    expect(inputs).toEqual({});
  });

  it('should handle mix of valid and complex inputs', () => {
    const inputs = parseInputs([
      'simple=value',
      'complex=key=value=with=multiple=equals',
      'empty=',
      'spaces=value with spaces',
    ]);
    expect(inputs).toEqual({
      simple: 'value',
      complex: 'key=value=with=multiple=equals',
      empty: '',
      spaces: 'value with spaces',
    });
  });
});

describe('parseJsonInputs', () => {
  it('should parse simple JSON object', () => {
    const json = '{"key": "value", "number": 42, "bool": true}';
    const inputs = parseJsonInputs(json);
    expect(inputs).toEqual({
      key: 'value',
      number: 42,
      bool: true,
    });
  });

  it('should handle complex objects', () => {
    const json = '{"obj": {"nested": "value"}, "arr": [1, 2, 3]}';
    const inputs = parseJsonInputs(json);
    expect(inputs).toEqual({
      obj: { nested: 'value' },
      arr: [1, 2, 3],
    });
  });

  it('should handle empty object', () => {
    const json = '{}';
    const inputs = parseJsonInputs(json);
    expect(inputs).toEqual({});
  });

  it('should handle string values with special characters', () => {
    const json =
      '{"special": "value with spaces", "equals": "key=value", "quotes": "value\\"with\\"quotes"}';
    const inputs = parseJsonInputs(json);
    expect(inputs).toEqual({
      special: 'value with spaces',
      equals: 'key=value',
      quotes: 'value"with"quotes',
    });
  });

  it('should throw error for invalid JSON', () => {
    const invalidJson = '{"invalid": json}';
    expect(() => parseJsonInputs(invalidJson)).toThrow('Invalid JSON input.');
  });

  it('should throw error for non-object JSON', () => {
    expect(() => parseJsonInputs('["array"]')).toThrow('Invalid JSON input.');

    expect(() => parseJsonInputs('"string"')).toThrow('Invalid JSON input.');

    expect(() => parseJsonInputs('42')).toThrow('Invalid JSON input.');

    expect(() => parseJsonInputs('null')).toThrow('Invalid JSON input.');
  });
});
