import Ajv from 'ajv';
import assert from 'assert';

import { AppleConfigReader } from './apple/config/reader';
import { AppleConfigWriter } from './apple/config/writer';
import { Metadata } from './schema';

/**
 * Run the JSON Schema validation to normalize defaults and flag early config errors.
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

/**
 * Create a versioned apple reader instance, based on the loaded config.
 * @todo Add versioning based on the configSchema property of the schema.
 */
export function createAppleReader(config: Metadata): AppleConfigReader {
  assert(config.apple, 'No apple configuration found');
  return new AppleConfigReader(config.apple);
}

/**
 * Create the latest
 */
export function createAppleWriter(): AppleConfigWriter {
  return new AppleConfigWriter();
}
