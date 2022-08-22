import Ajv from 'ajv';
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';

import { AppleConfigReader } from './apple/config/reader';
import { AppleConfigWriter } from './apple/config/writer';
import { AppleMetadata } from './apple/types';
import { MetadataValidationError } from './errors';

export interface MetadataConfig {
  /** The store configuration version */
  configVersion: number;
  /** All App Store related configuration */
  apple?: AppleMetadata;
}

/**
 * Resolve the dynamic config from the user.
 * It supports methods, async methods, or objects (json).
 */
async function resolveDynamicConfigAsync(configFile: string): Promise<unknown> {
  const userConfigOrFunction = await import(configFile).then(file => file.default ?? file);

  return typeof userConfigOrFunction === 'function'
    ? await userConfigOrFunction()
    : userConfigOrFunction;
}

/**
 * Get the static configuration file path, based on the metadata context.
 * This uses any custom name provided, but swaps out the extension for `.json`.
 */
export function getStaticConfigFilePath({
  projectDir,
  metadataPath,
}: {
  projectDir: string;
  metadataPath: string;
}): string {
  const configFile = path.join(projectDir, metadataPath);
  const configExtension = path.extname(configFile);

  return path.join(projectDir, `${path.basename(configFile, configExtension)}.json`);
}

/**
 * Load the store configuration from a metadata context.
 * This can load `.json` and `.js` config files, using `require`.
 * It throws MetadataValidationErrors when the file doesn't exist, or contains errors.
 * The user is prompted to try anyway when errors are found.
 */
export async function loadConfigAsync({
  projectDir,
  metadataPath,
  skipValidation = false,
}: {
  projectDir: string;
  metadataPath: string;
  skipValidation?: boolean;
}): Promise<MetadataConfig> {
  const configFile = path.join(projectDir, metadataPath);
  if (!(await fs.pathExists(configFile))) {
    throw new MetadataValidationError(`Metadata store config file not found: "${configFile}"`);
  }

  const configData = await resolveDynamicConfigAsync(configFile);

  if (!skipValidation) {
    const { valid, errors: validationErrors } = validateConfig(configData);

    if (!valid) {
      throw new MetadataValidationError(`Metadata store config errors found`, validationErrors);
    }
  }

  return configData as MetadataConfig;
}

/**
 * Run the JSON Schema validation to normalize defaults and flag early config errors.
 * This includes validating the known store limitations for every configurable property.
 */
export function validateConfig(config: unknown): {
  valid: boolean;
  errors: Ajv.ErrorObject[];
} {
  const validator = new Ajv({ allErrors: true, useDefaults: true })
    .addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'))
    .compile(require('../../schema/metadata-0.json'));

  const valid = validator(config) as boolean;

  return { valid, errors: validator.errors || [] };
}

/** Create a versioned deserializer to fetch App Store data from the store configuration. */
export function createAppleReader(config: MetadataConfig): AppleConfigReader {
  assert(config.configVersion === 0, 'Unsupported store configuration version');
  assert(config.apple, 'No apple configuration found');
  return new AppleConfigReader(config.apple);
}

/** Create the serializer to write the App Store to the store configuration. */
export function createAppleWriter(): AppleConfigWriter {
  return new AppleConfigWriter();
}
