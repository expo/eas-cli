import { AggregateAjvError, HumanError } from '@segment/ajv-human-errors';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const jsonSchema = require('ajv/lib/refs/json-schema-draft-06.json');

/**
 * Create a new AJV validator using the JSON Schema 06 draft.
 * It also adds the additional formats from the `ajv-formats` package.
 *
 * @see https://github.com/ajv-validator/ajv-formats
 */
export function createValidator(): Ajv {
  const validator = new Ajv({
    strict: false, // The metadata schema is shared with vscode, including vscode-only properties
    verbose: true, // Required for `ajv-human-errors`
    allErrors: true, // Required for `ajv-human-errors`
  });

  return addFormats(validator).addMetaSchema(jsonSchema);
}

export function getReadableErrors(errors: any[] = []): HumanError[] {
  if (errors.length === 0) {
    return [];
  }

  // `ajv` exports a generic ErrorObject type that may not match the shape
  // expected by `@segment/ajv-human-errors`. Use `any[]` here to accept
  // both old and new ajv error shapes and let the human-errors library
  // perform the transformation.
  return new AggregateAjvError(errors as any).toJSON();
}
