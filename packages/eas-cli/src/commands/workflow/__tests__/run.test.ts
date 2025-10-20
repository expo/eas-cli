import {
  parseInputs,
  parseJsonInputs,
  parseWorkflowInputsFromYaml,
} from '../../../commandUtils/workflow/inputs';

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

describe('parseWorkflowInputsFromYaml', () => {
  it('should parse workflow inputs from YAML', () => {
    const yamlConfig = `
on:
  workflow_dispatch:
    inputs:
      environment:
        type: string
        required: true
        description: "Environment to deploy to"
      debug:
        type: boolean
        default: false
        description: "Enable debug mode"
      version:
        type: number
        required: true
        description: "Version number"
      deployment_type:
        type: choice
        options: ["staging", "production"]
        default: "staging"
        description: "Type of deployment"
      target_env:
        type: environment
        default: "preview"
        description: "Target environment"
jobs:
  test:
    steps:
      - run: echo "test"
`;

    const inputs = parseWorkflowInputsFromYaml(yamlConfig);

    expect(inputs).toEqual({
      environment: {
        type: 'string',
        required: true,
        description: 'Environment to deploy to',
      },
      debug: {
        type: 'boolean',
        required: false,
        default: false,
        description: 'Enable debug mode',
      },
      version: {
        type: 'number',
        required: true,
        description: 'Version number',
      },
      deployment_type: {
        type: 'choice',
        required: false,
        default: 'staging',
        options: ['staging', 'production'],
        description: 'Type of deployment',
      },
      target_env: {
        type: 'environment',
        required: false,
        default: 'preview',
        description: 'Target environment',
      },
    });
  });

  it('should handle YAML without workflow_dispatch inputs', () => {
    const yamlConfig = `
on:
  push:
    branches: [main]
jobs:
  test:
    steps:
      - run: echo "test"
`;

    const inputs = parseWorkflowInputsFromYaml(yamlConfig);

    expect(inputs).toEqual({});
  });

  it('should handle empty YAML', () => {
    const yamlConfig = '';

    const inputs = parseWorkflowInputsFromYaml(yamlConfig);

    expect(inputs).toEqual({});
  });

  it('should handle invalid YAML gracefully', () => {
    const yamlConfig = 'invalid: yaml: content:';

    const inputs = parseWorkflowInputsFromYaml(yamlConfig);

    expect(inputs).toEqual({});
  });

  it('should default type to string when not specified', () => {
    const yamlConfig = `
on:
  workflow_dispatch:
    inputs:
      simple_input:
        description: "A simple input"
        required: true
`;

    const inputs = parseWorkflowInputsFromYaml(yamlConfig);

    expect(inputs.simple_input).toEqual({
      type: 'string',
      description: 'A simple input',
      required: true,
    });
  });
});
