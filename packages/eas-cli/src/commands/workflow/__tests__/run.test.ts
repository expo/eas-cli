import { parseInputs } from '../run';

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
