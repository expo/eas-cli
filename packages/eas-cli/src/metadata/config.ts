import Ajv from 'ajv';
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';
import util from 'util';

import Log from '../log';
import { confirmAsync } from '../prompts';
import { AppleConfigReader } from './apple/config/reader';
import { AppleConfigWriter } from './apple/config/writer';
import { AppleMetadata } from './apple/types';
import { MetadataContext } from './context';
import { MetadataValidationError, logMetadataValidationError } from './errors';

export interface MetadataConfig {
  /** The store configuration version */
  configVersion: number;
  /** All App Store related configuration */
  apple?: AppleMetadata;
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
}: Pick<MetadataContext, 'projectDir' | 'metadataPath'>): Promise<MetadataConfig> {
  const configFile = path.join(projectDir, metadataPath);
  if (!(await fs.pathExists(configFile))) {
    throw new MetadataValidationError(`Metadata store config file not found: "${configFile}"`);
  }

  const configData = require(configFile);
  const { valid, errors: validationErrors } = validateConfig(configData);

  if (!valid) {
    const error = new MetadataValidationError(
      `Metadata store config errors found`,
      validationErrors
    );

    logMetadataValidationError(error);
    Log.newLine();
    Log.warn(
      'Without further updates, the current store configuration may fail to be synchronized with the App Store or pass App Store review.'
    );

    if (await confirmAsync({ message: 'Do you still want to push the store configuration?' })) {
      return configData;
    } else {
      throw error;
    }
  }

  return configData;
}

/**
 * Save the store config file, based on the file type extension.
 * It supports both `.js` and `.json` files, where:
 *   - JSON files are stringified
 *   - JS files have a `module.exports = {inspect(config)};` template
 */
export async function saveConfigAsync(
  config: MetadataConfig,
  { projectDir, metadataPath }: Pick<MetadataContext, 'projectDir' | 'metadataPath'>
): Promise<void> {
  const configFile = path.join(projectDir, metadataPath);
  const configExtension = path.extname(configFile);

  switch (configExtension) {
    case '.json':
      return await fs.writeJson(configFile, config, { spaces: 2 });
    case '.js':
      return await fs.writeFile(
        configFile,
        `module.exports = ${util.inspect(config, { depth: null })};\n`
      );
    default:
      throw new MetadataValidationError(
        `Unkown store config extension: "${configExtension}" for "${metadataPath}". Use ".json" or ".js" instead.`
      );
  }
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
