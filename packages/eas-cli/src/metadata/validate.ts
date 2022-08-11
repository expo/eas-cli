import Ajv from 'ajv';

export interface LintMessage {
  /** The severity of the lint message, either (0 = info, 1 = warn, 2 = error) */
  severity: 0 | 1 | 2;
  /** A human readable description of the issue, presented to users */
  message: string;
}

/**
 * Run the JSON Schema validation to normalize defaults and flag early config errors.
 * This includes validating the known store limitations for every configurable property.
 */
export function validateStoreSchema(config: unknown): {
  valid: boolean;
  errors: Ajv.ErrorObject[];
} {
  const validator = new Ajv({ allErrors: true, useDefaults: true })
    .addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'))
    .compile(require('../../schema/metadata-0.json'));

  const valid = validator(config) as boolean;

  return { valid, errors: validator.errors || [] };
}
