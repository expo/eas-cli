import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';

import Joi from 'joi';
import YAML from 'yaml';

import { BuildConfigError, BuildWorkflowError } from './errors';
import { BuildRuntimePlatform } from './BuildRuntimePlatform';
import { BuildStepInputValueTypeName, BuildStepInputValueType } from './BuildStepInput';
import { BuildStepEnv } from './BuildStepEnv';
import { BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX } from './utils/template';

export type BuildFunctions = Record<string, BuildFunctionConfig>;

interface BuildFunctionsConfigFile {
  configFilesToImport?: string[];
  functions?: BuildFunctions;
}

export interface BuildConfig extends BuildFunctionsConfigFile {
  build: {
    name?: string;
    steps: BuildStepConfig[];
  };
}

export type BuildStepConfig =
  | BuildStepCommandRun
  | BuildStepBareCommandRun
  | BuildStepFunctionCall
  | BuildStepBareFunctionOrFunctionGroupCall;

export type BuildStepCommandRun = {
  run: BuildFunctionCallConfig & {
    outputs?: BuildStepOutputs;
    command: string;
  };
};
export type BuildStepBareCommandRun = { run: string };
export type BuildStepFunctionCall = {
  [functionId: string]: BuildFunctionCallConfig;
};
export type BuildStepBareFunctionOrFunctionGroupCall = string;

export type BuildFunctionCallConfig = {
  id?: string;
  inputs?: BuildStepInputs;
  name?: string;
  workingDirectory?: string;
  shell?: string;
  env?: BuildStepEnv;
  if?: string;
  timeout_minutes?: number;
  // Internal field for metrics collection. Not documented publicly.
  __metrics_id?: string;
};

export type BuildStepInputs = Record<string, unknown>;
export type BuildStepOutputs = (
  | string
  | {
      name: string;
      required?: boolean;
    }
)[];

export interface BuildFunctionConfig {
  inputs?: BuildFunctionInputs;
  outputs?: BuildFunctionOutputs;
  name?: string;
  supportedRuntimePlatforms?: BuildRuntimePlatform[];
  shell?: string;
  command?: string;
  path?: string;
}

export type BuildFunctionInputs = (
  | string
  | {
      name: string;
      defaultValue?: BuildStepInputValueType;
      allowedValues?: BuildStepInputValueType[];
      required?: boolean;
      allowedValueType: BuildStepInputValueTypeName;
    }
)[];
export type BuildFunctionOutputs = BuildStepOutputs;

const BuildFunctionInputsSchema = Joi.array().items(
  Joi.alternatives().conditional(Joi.ref('.'), {
    is: Joi.string(),
    then: Joi.string().required(),
    otherwise: Joi.object({
      name: Joi.string().required(),
      defaultValue: Joi.when('allowedValues', {
        is: Joi.exist(),
        then: Joi.valid(Joi.in('allowedValues')).messages({
          'any.only': '{{#label}} must be one of allowed values',
        }),
      })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.STRING,
          then: Joi.string().allow(''),
        })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.BOOLEAN,
          then: Joi.alternatives(
            Joi.boolean(),
            Joi.string().pattern(
              BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX,
              'context or output reference regex pattern'
            )
          ).messages({
            'alternatives.types':
              '{{#label}} must be a boolean or reference to output or context value',
          }),
        })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.NUMBER,
          then: Joi.alternatives(
            Joi.number(),
            Joi.string().pattern(
              BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX,
              'context or output reference regex pattern'
            )
          ).messages({
            'alternatives.types':
              '{{#label}} must be a number or reference to output or context value',
          }),
        })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.JSON,
          then: Joi.alternatives(
            Joi.object(),
            Joi.string().pattern(
              BUILD_STEP_OR_BUILD_GLOBAL_CONTEXT_REFERENCE_REGEX,
              'context or output reference regex pattern'
            )
          ).messages({
            'alternatives.types':
              '{{#label}} must be a object or reference to output or context value',
          }),
        }),
      allowedValues: Joi.when('allowedValueType', {
        is: BuildStepInputValueTypeName.STRING,
        then: Joi.array().items(Joi.string().allow('')),
      })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.BOOLEAN,
          then: Joi.array().items(Joi.boolean()),
        })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.NUMBER,
          then: Joi.array().items(Joi.number()),
        })
        .when('allowedValueType', {
          is: BuildStepInputValueTypeName.JSON,
          then: Joi.array().items(Joi.object()),
        }),
      allowedValueType: Joi.string()
        .valid(...Object.values(BuildStepInputValueTypeName))
        .default(BuildStepInputValueTypeName.STRING),
      required: Joi.boolean(),
    })
      .rename('allowed_values', 'allowedValues')
      .rename('default_value', 'defaultValue')
      .rename('type', 'allowedValueType')
      .required(),
  })
);

const BuildStepOutputsSchema = Joi.array().items(
  Joi.alternatives().try(
    Joi.string().required(),
    Joi.object({
      name: Joi.string().required(),
      required: Joi.boolean(),
    }).required()
  )
);

const BuildFunctionCallSchema = Joi.object({
  id: Joi.string(),
  inputs: Joi.object().pattern(
    Joi.string(),
    Joi.alternatives().try(Joi.string().allow(''), Joi.boolean(), Joi.number(), Joi.object())
  ),
  name: Joi.string(),
  workingDirectory: Joi.string(),
  shell: Joi.string(),
  env: Joi.object().pattern(Joi.string(), Joi.string().allow('')),
  if: Joi.string(),
  timeout_minutes: Joi.number().positive(),
  // Internal field for metrics collection. Not documented publicly.
  __metrics_id: Joi.string(),
}).rename('working_directory', 'workingDirectory');

const BuildStepConfigSchema = Joi.any<BuildStepConfig>()
  .invalid(null)
  .when(
    Joi.object().pattern(
      Joi.string().disallow('run').required(),
      Joi.object().unknown().required()
    ),
    {
      then: Joi.object().pattern(
        Joi.string().disallow('run').min(1).required(),
        BuildFunctionCallSchema.required(),
        { matches: Joi.array().length(1) }
      ),
    }
  )
  .when(Joi.object({ run: Joi.object().unknown().required() }), {
    then: Joi.object({
      run: BuildFunctionCallSchema.keys({
        outputs: BuildStepOutputsSchema,
        command: Joi.string().required(),
      }),
    }),
  })
  .when(Joi.object({ run: Joi.string().required() }), {
    then: Joi.object({
      run: Joi.string().min(1).required(),
    }),
  })
  .when(Joi.string(), {
    then: Joi.string().min(1),
  });

const BuildFunctionConfigSchema = Joi.object({
  name: Joi.string(),
  supportedRuntimePlatforms: Joi.array().items(...Object.values(BuildRuntimePlatform)),
  inputs: BuildFunctionInputsSchema,
  outputs: BuildStepOutputsSchema,
  command: Joi.string(),
  path: Joi.string(),
  shell: Joi.string(),
})
  .rename('supported_platforms', 'supportedRuntimePlatforms')
  .xor('command', 'path')
  .nand('command', 'path');

export const BuildFunctionsConfigFileSchema = Joi.object<BuildFunctionsConfigFile>({
  configFilesToImport: Joi.array().items(Joi.string().pattern(/\.y(a)?ml$/)),
  functions: Joi.object().pattern(
    Joi.string()
      .pattern(/^[\w-]+$/, 'function names')
      .min(1)
      .required()
      .disallow('run'),
    BuildFunctionConfigSchema.required()
  ),
})
  .rename('import', 'configFilesToImport')
  .required();

export const BuildConfigSchema = BuildFunctionsConfigFileSchema.append<BuildConfig>({
  build: Joi.object({
    name: Joi.string(),
    steps: Joi.array().items(BuildStepConfigSchema.required()).required(),
  }).required(),
}).required();

interface BuildConfigValidationParams {
  externalFunctionIds?: string[];
  externalFunctionGroupsIds?: string[];
  skipNamespacedFunctionsOrFunctionGroupsCheck?: boolean;
}

export async function readAndValidateBuildConfigFromPathAsync(
  configPath: string,
  params: BuildConfigValidationParams = {}
): Promise<BuildConfig> {
  const rawConfig = await readRawBuildConfigAsync(configPath);

  const config = validateConfig(BuildConfigSchema, rawConfig);
  for (const functionName in config.functions) {
    const customFunctionPath = config.functions[functionName].path;
    if (customFunctionPath) {
      config.functions[functionName].path = maybeResolveCustomFunctionRelativePath(
        path.dirname(configPath),
        customFunctionPath
      );
    }
  }

  const importedFunctions = await importFunctionsAsync(configPath, config.configFilesToImport);
  mergeConfigWithImportedFunctions(config, importedFunctions);
  validateAllFunctionsExist(config, params);
  return config;
}

async function importFunctionsAsync(
  baseConfigPath: string,
  configPathsToImport?: string[]
): Promise<BuildFunctions> {
  if (!configPathsToImport) {
    return {};
  }

  const baseConfigDir = path.dirname(baseConfigPath);

  const errors: BuildConfigError[] = [];
  const importedFunctions: BuildFunctions = {};
  // this is a set of visited files identified by ABSOLUTE paths
  const visitedFiles = new Set<string>([baseConfigPath]);
  const configFilesToVisit = (configPathsToImport ?? []).map((childConfigRelativePath) =>
    path.resolve(baseConfigDir, childConfigRelativePath)
  );
  while (configFilesToVisit.length > 0) {
    const childConfigPath = configFilesToVisit.shift();
    assert(childConfigPath, 'Guaranteed by loop condition');
    if (visitedFiles.has(childConfigPath)) {
      continue;
    }
    visitedFiles.add(childConfigPath);
    try {
      const childConfig = await readAndValidateBuildFunctionsConfigFileAsync(childConfigPath);
      const childDir = path.dirname(childConfigPath);
      for (const functionName in childConfig.functions) {
        if (!(functionName in importedFunctions)) {
          const f = childConfig.functions[functionName];
          if (f.path) {
            f.path = maybeResolveCustomFunctionRelativePath(childDir, f.path);
          }
          importedFunctions[functionName] = f;
        }
      }
      if (childConfig.configFilesToImport) {
        configFilesToVisit.push(
          ...childConfig.configFilesToImport.map((relativePath) =>
            path.resolve(childDir, relativePath)
          )
        );
      }
    } catch (err) {
      if (err instanceof BuildConfigError) {
        errors.push(err);
      } else {
        throw err;
      }
    }
  }
  if (errors.length > 0) {
    throw new BuildWorkflowError(`Detected build config errors in imported files.`, errors);
  }
  return importedFunctions;
}

export async function readAndValidateBuildFunctionsConfigFileAsync(
  configPath: string
): Promise<BuildFunctionsConfigFile> {
  const rawConfig = await readRawBuildConfigAsync(configPath);
  return validateConfig(BuildFunctionsConfigFileSchema, rawConfig);
}

export async function readRawBuildConfigAsync(configPath: string): Promise<any> {
  const contents = await fs.readFile(configPath, 'utf-8');
  return YAML.parse(contents);
}

export function validateConfig<T>(
  schema: Joi.ObjectSchema<T>,
  config: object,
  configFilePath?: string
): T {
  const { error, value } = schema.validate(config, {
    allowUnknown: false,
    abortEarly: false,
  });
  if (error) {
    const errorMessage = error.details.map(({ message }) => message).join(', ');
    throw new BuildConfigError(errorMessage, {
      cause: error,
      ...(configFilePath && { metadata: { configFilePath } }),
    });
  }
  return value;
}

export function mergeConfigWithImportedFunctions(
  config: BuildConfig,
  importedFunctions: BuildFunctions
): void {
  if (Object.keys(importedFunctions).length === 0) {
    return;
  }
  config.functions = config.functions ?? {};
  for (const functionName in importedFunctions) {
    if (!(functionName in config.functions)) {
      config.functions[functionName] = importedFunctions[functionName];
    }
  }
}

export function isBuildStepCommandRun(step: BuildStepConfig): step is BuildStepCommandRun {
  return Boolean(step) && typeof step === 'object' && typeof step.run === 'object';
}

export function isBuildStepBareCommandRun(step: BuildStepConfig): step is BuildStepBareCommandRun {
  return Boolean(step) && typeof step === 'object' && typeof step.run === 'string';
}

export function isBuildStepFunctionCall(step: BuildStepConfig): step is BuildStepFunctionCall {
  return Boolean(step) && typeof step === 'object' && !('run' in step);
}

export function isBuildStepBareFunctionOrFunctionGroupCall(
  step: BuildStepConfig
): step is BuildStepBareFunctionOrFunctionGroupCall {
  return typeof step === 'string';
}

export function validateAllFunctionsExist(
  config: BuildConfig,
  {
    externalFunctionIds = [],
    externalFunctionGroupsIds = [],
    skipNamespacedFunctionsOrFunctionGroupsCheck,
  }: BuildConfigValidationParams
): void {
  const calledFunctionsOrFunctionGroupsSet = new Set<string>();
  for (const step of config.build.steps) {
    if (typeof step === 'string') {
      calledFunctionsOrFunctionGroupsSet.add(step);
    } else if (step !== null && !('run' in step)) {
      const keys = Object.keys(step);
      assert(
        keys.length === 1,
        'There must be at most one function call in the step (enforced by joi).'
      );
      calledFunctionsOrFunctionGroupsSet.add(keys[0]);
    }
  }
  const calledFunctionsOrFunctionGroup = Array.from(calledFunctionsOrFunctionGroupsSet);
  const externalFunctionIdsSet = new Set(externalFunctionIds);
  const externalFunctionGroupsIdsSet = new Set(externalFunctionGroupsIds);
  const nonExistentFunctionsOrFunctionGroups = calledFunctionsOrFunctionGroup.filter(
    (calledFunctionOrFunctionGroup) => {
      if (
        isFullIdNamespaced(calledFunctionOrFunctionGroup) &&
        skipNamespacedFunctionsOrFunctionGroupsCheck
      ) {
        return false;
      }
      return (
        !(calledFunctionOrFunctionGroup in (config.functions ?? {})) &&
        !externalFunctionIdsSet.has(calledFunctionOrFunctionGroup) &&
        !externalFunctionGroupsIdsSet.has(calledFunctionOrFunctionGroup)
      );
    }
  );
  if (nonExistentFunctionsOrFunctionGroups.length > 0) {
    throw new BuildConfigError(
      `Calling non-existent functions: ${nonExistentFunctionsOrFunctionGroups
        .map((f) => `"${f}"`)
        .join(', ')}.`
    );
  }
}

function maybeResolveCustomFunctionRelativePath(dir: string, customFunctionPath: string): string {
  if (!path.isAbsolute(customFunctionPath)) {
    return path.resolve(dir, customFunctionPath);
  }
  return customFunctionPath;
}

function isFullIdNamespaced(fullId: string): boolean {
  return fullId.includes('/');
}
