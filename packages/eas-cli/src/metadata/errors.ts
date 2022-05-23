import type { ErrorObject } from 'ajv';

export class MetadataValidationError extends Error {
  constructor(message?: string, public readonly errors?: ErrorObject[]) {
    super(message ?? 'Metadata validation failed');
  }
}

export class MetadataUploadError extends Error {
  constructor(public readonly errors: Error[], public readonly executionId: string) {
    super(
      `Metadata encountered ${
        errors.length === 1 ? 'an error' : `${errors.length} errors`
      } during upload.`
    );
  }
}
