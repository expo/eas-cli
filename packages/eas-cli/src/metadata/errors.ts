import type { ErrorObject } from 'ajv';

/**
 * Before syncing data to the ASC API, we need to validate the metadata config.
 * This error represents unrecoverable issues before syncing that data,
 * and should contain useful information for the user to solve before trying again.
 */
export class MetadataValidationError extends Error {
  constructor(message?: string, public readonly errors?: ErrorObject[]) {
    super(message ?? 'Metadata validation failed');
  }
}

/**
 * If a single entity failed to sync, we don't block the other entities from syncing.
 * We still attempt to sync the configured data to the ASC API.
 * Because of that, we keep track of any errors encountered and throw this generic error at the end.
 * It contains that list of encountered errors to present to the user.
 */
export class MetadataUploadError extends Error {
  constructor(public readonly errors: Error[], public readonly executionId: string) {
    super(
      `Metadata encountered ${
        errors.length === 1 ? 'an error' : `${errors.length} errors`
      } during upload.`
    );
  }
}
