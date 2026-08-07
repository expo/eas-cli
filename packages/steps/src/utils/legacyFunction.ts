/**
 * Maps a single-step local function config (`command` or `path` in `function.yml`, the shape
 * custom build functions use in `.eas/build/*.yml`) onto a {@link BuildFunction}, so calling one
 * from a workflow runs it exactly like a custom build does.
 *
 * Legacy semantics are preserved: inputs and outputs are required unless declared otherwise,
 * which is the opposite of the composite function default.
 */
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

type LegacyFunctionInput = NonNullable<LegacyFunctionConfig['inputs']>[number];

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
    defaultValue: input.default_value,
    allowedValues: input.allowed_values,
    allowedValueTypeName: parseBuildStepInputValueTypeName(input.type),
  });
}
