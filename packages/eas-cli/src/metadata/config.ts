import Ajv from 'ajv';
import assert from 'assert';

import { AppleConfigReader } from './apple/config/reader';
import { AppleConfigWriter } from './apple/config/writer';
import { Metadata } from './types';

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
export function createAppleReader(config: Metadata): AppleConfigReader {
  assert(config.configVersion === 0, 'Unsupported store configuration version');
  assert(config.apple, 'No apple configuration found');
  return new AppleConfigReader(config.apple);
}

/** Create the serializer to write the App Store to the store configuration. */
export function createAppleWriter(): AppleConfigWriter {
  return new AppleConfigWriter();
}
