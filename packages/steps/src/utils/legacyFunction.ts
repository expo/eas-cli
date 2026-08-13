/**
 * Maps a single-step local function config (`command` or `path` in `function.yml`, the shape
 * custom build functions use in `.eas/build/*.yml`) onto a {@link BuildFunction}, so calling one
 * from a workflow runs it exactly like a custom build does.
 *
 * Legacy semantics are preserved: inputs and outputs are required unless declared otherwise,
 * which is the opposite of the composite function default.
 */
import { isDeepStrictEqual } from 'util';

import { LegacyFunctionConfig } from '@expo/eas-build-job';

import { BuildFunction } from '../BuildFunction';
import { BuildRuntimePlatform } from '../BuildRuntimePlatform';
import {
  BuildStepInput,
  BuildStepInputProvider,
  BuildStepInputValueTypeName,
  parseBuildStepInputValueTypeName,
} from '../BuildStepInput';
import { createBuildStepOutputProviderFromDefinition } from '../BuildStepOutput';
import { BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX } from './template';

type LegacyFunctionInput = NonNullable<LegacyFunctionConfig['inputs']>[number];
type LegacyFunctionObjectInput = Exclude<LegacyFunctionInput, string>;
type LegacyFunctionInputValue = LegacyFunctionObjectInput['default_value'];

export function createBuildFunctionFromLegacyFunctionConfig(
  functionPath: string,
  config: LegacyFunctionConfig
): BuildFunction {
  return new BuildFunction({
    id: functionPath,
    name: config.name,
    command: config.command,
    customFunctionModulePath: config.path,
    shell: config.shell,
    supportedRuntimePlatforms: config.supported_platforms?.map(
      platform => platform satisfies `${BuildRuntimePlatform}` as BuildRuntimePlatform
    ),
    inputProviders: config.inputs?.map(createInputProvider),
    outputProviders: config.outputs?.map(createBuildStepOutputProviderFromDefinition),
  });
}

function createInputProvider(input: LegacyFunctionInput): BuildStepInputProvider {
  if (typeof input === 'string') {
    return BuildStepInput.createProvider({
      id: input,
      required: true,
      allowedValueTypeName: BuildStepInputValueTypeName.STRING,
    });
  }
  return BuildStepInput.createProvider({
    id: input.name,
    required: input.required ?? true,
    defaultValue: coerceLegacyFunctionInputValue(input.type, input.default_value),
    allowedValues: input.allowed_values?.map(value =>
      coerceLegacyFunctionInputValue(input.type, value)
    ),
    allowedValueTypeName: parseBuildStepInputValueTypeName(input.type),
  });
}

function isStepOrContextReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX.test(value) ||
      (value.startsWith('${{') && value.endsWith('}}')))
  );
}

// Matches the coercions the custom build Joi schema applies to quoted values
function coerceLegacyFunctionInputValue<V extends LegacyFunctionInputValue>(
  type: LegacyFunctionObjectInput['type'],
  value: V
): V | number | boolean {
  if (typeof value !== 'string') {
    return value;
  }
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (type === 'boolean' && (value === 'true' || value === 'false')) {
    return value === 'true';
  }
  return value;
}

function matchesLegacyFunctionInputType(
  type: LegacyFunctionObjectInput['type'],
  value: NonNullable<LegacyFunctionInputValue>,
  { allowReference }: { allowReference: boolean }
): boolean {
  if (type === 'string') {
    return typeof value === 'string';
  }
  if (allowReference && isStepOrContextReference(value)) {
    return true;
  }
  if (type === 'json') {
    return typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === type;
}

function renderLegacyFunctionInputValue(value: NonNullable<LegacyFunctionInputValue>): string {
  return typeof value === 'object' ? JSON.stringify(value) : `"${value}"`;
}

/**
 * Coerces quoted `default_value` and `allowed_values` entries to the declared input type,
 * like the original custom build Joi schema does.
 */
export function normalizeLegacyFunctionConfigInputs(
  functionPath: string,
  config: LegacyFunctionConfig
): void {
  const issues: string[] = [];
  for (const input of config.inputs ?? []) {
    if (typeof input === 'string') {
      continue;
    }
    input.default_value = coerceLegacyFunctionInputValue(input.type, input.default_value);
    input.allowed_values = input.allowed_values?.map(value =>
      coerceLegacyFunctionInputValue(input.type, value)
    );

    let typesAreValid = true;
    for (const value of input.allowed_values ?? []) {
      if (!matchesLegacyFunctionInputType(input.type, value, { allowReference: false })) {
        typesAreValid = false;
        issues.push(
          `"allowed_values" of input "${input.name}" contains ${renderLegacyFunctionInputValue(
            value
          )} which is not of type "${input.type}".`
        );
      }
    }
    if (
      input.default_value !== undefined &&
      !matchesLegacyFunctionInputType(input.type, input.default_value, { allowReference: true })
    ) {
      typesAreValid = false;
      issues.push(
        `"default_value" of input "${input.name}" is set to ${renderLegacyFunctionInputValue(
          input.default_value
        )} which is not of type "${input.type}"${
          input.type === 'string' ? '' : ' or a step or context reference'
        }.`
      );
    }

    if (
      typesAreValid &&
      input.default_value !== undefined &&
      input.allowed_values !== undefined &&
      !input.allowed_values.some(value => isDeepStrictEqual(value, input.default_value))
    ) {
      issues.push(
        `"default_value" of input "${input.name}" is set to ${renderLegacyFunctionInputValue(
          input.default_value
        )} which is not one of the allowed values: ${input.allowed_values
          .map(renderLegacyFunctionInputValue)
          .join(', ')}.`
      );
    }
  }
  if (issues.length > 0) {
    throw new Error(`Invalid local function "${functionPath}": ${issues.join('\n')}`);
  }
}
