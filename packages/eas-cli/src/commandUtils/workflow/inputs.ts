import * as YAML from 'yaml';
import { z } from 'zod';

import { DefaultEnvironment } from '../../build/utils/environment';
import { booleanLike, stringLike } from '../../credentials/ios/types';
import Log from '../../log';
import { promptAsync } from '../../prompts';

const inputExtraProperties = {
  description: stringLike.optional().describe('Description of the input'),
  required: booleanLike.default(false).optional().describe('Whether the input is required.'),
};

// Adapted from the input definition on the server (https://github.com/expo/universe/pull/21950)
export const WorkflowDispatchInputZ = z.discriminatedUnion('type', [
  z.object({
    ...inputExtraProperties,
    type: z.literal('string').default('string').optional(),
    default: stringLike.optional().describe('Default value for the input'),
  }),
  z.object({
    ...inputExtraProperties,
    type: z.literal('boolean'),
    default: booleanLike.optional().describe('Default value for the input'),
  }),
  z.object({
    ...inputExtraProperties,
    type: z.literal('number'),
    default: z.number().optional().describe('Default value for the input'),
  }),
  z.object({
    ...inputExtraProperties,
    type: z.literal('choice'),
    default: stringLike.optional().describe('Default value for the input'),
    options: z.array(stringLike).min(1).describe('Options for choice type inputs'),
  }),
  z.object({
    ...inputExtraProperties,
    type: z.literal('environment'),
    default: z
      .enum(Object.values(DefaultEnvironment))
      .optional()
      .describe('Default value for the input'),
  }),
]);
export function parseInputs(inputFlags: string[]): Record<string, string> {
  const inputs: Record<string, string> = {};

  for (const inputFlag of inputFlags) {
    const equalIndex = inputFlag.indexOf('=');
    if (equalIndex === -1) {
      throw new Error(`Invalid input format: ${inputFlag}. Expected key=value format.`);
    }

    const key = inputFlag.substring(0, equalIndex);
    const value = inputFlag.substring(equalIndex + 1);

    if (!key) {
      throw new Error(`Invalid input format: ${inputFlag}. Key cannot be empty.`);
    }

    inputs[key] = value;
  }

  return inputs;
}

export function parseJsonInputs(jsonString: string): Record<string, string> {
  try {
    const parsed = JSON.parse(jsonString);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('JSON input must be an object.');
    }

    return parsed;
  } catch (error) {
    throw new Error(`Invalid JSON input.`, { cause: error });
  }
}

export function parseWorkflowInputsFromYaml(
  yamlConfig: string
): Record<string, z.infer<typeof WorkflowDispatchInputZ>> {
  try {
    const parsed = YAML.parse(yamlConfig);
    return z
      .record(z.string(), WorkflowDispatchInputZ)
      .default({})
      .parse(parsed?.on?.workflow_dispatch?.inputs);
  } catch (error) {
    Log.warn('Failed to parse workflow inputs from YAML:', error);
    return {};
  }
}
export async function maybePromptForMissingInputsAsync({
  inputSpecs,
  inputs,
}: {
  inputSpecs: Record<string, z.infer<typeof WorkflowDispatchInputZ>>;
  inputs: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const requiredInputs = Object.entries(inputSpecs).filter(([_, spec]) => spec.required);

  const missingRequiredInputs = requiredInputs.filter(([key]) => inputs[key] === undefined);

  if (missingRequiredInputs.length === 0) {
    return inputs;
  }

  Log.addNewLineIfNone();
  Log.log('Some required inputs are missing. Please provide them:');

  const nextInputs = { ...inputs };

  for (const [key, spec] of missingRequiredInputs) {
    const value = await promptForMissingInputAsync({ key, spec });
    nextInputs[key] = value;
  }

  return nextInputs;
}

async function promptForMissingInputAsync({
  key,
  spec,
}: {
  key: string;
  spec: z.infer<typeof WorkflowDispatchInputZ>;
}): Promise<unknown> {
  const message = spec.description ? `${key} (${spec.description})` : key;

  switch (spec.type) {
    case 'boolean': {
      const { value } = await promptAsync({
        type: 'confirm',
        name: 'value',
        message,
        initial: spec.default,
      });
      return value;
    }

    case 'number': {
      const { value } = await promptAsync({
        type: 'number',
        name: 'value',
        message,
        initial: spec.default,
        validate: (val: number) => {
          if (isNaN(val)) {
            return 'Please enter a valid number';
          }
          return true;
        },
      });
      return value;
    }

    case 'choice': {
      const { value } = await promptAsync({
        type: 'select',
        name: 'value',
        message,
        choices: spec.options.map(option => ({
          title: option,
          value: option,
        })),
        initial: spec.default,
      });
      return value;
    }

    case 'string':
    case 'environment':
    default: {
      const { value } = await promptAsync({
        type: 'text',
        name: 'value',
        message,
        initial: spec.default,
        validate: (val: string) => {
          if (spec.required && (!val || val.trim() === '')) {
            return 'This field is required';
          }
          return true;
        },
      });
      return value;
    }
  }
}
