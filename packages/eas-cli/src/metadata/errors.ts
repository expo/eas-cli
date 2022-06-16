import type { ErrorObject } from 'ajv';
import chalk from 'chalk';

import Log, { link } from '../log';

/**
 * Before syncing data to the ASC API, we need to validate the metadata config.
 * This error represents unrecoverable issues before syncing that data,
 * and should contain useful information for the user to solve before trying again.
 */
export class MetadataValidationError extends Error {
  public constructor(message?: string, public readonly errors: ErrorObject[] = []) {
    super(message ?? 'Store configuration validation failed');
  }
}

/**
 * During telemetry actions, a random exection ID is generated.
 * This ID should be communicated to users and reported to us.
 * With that ID, we can look up the failed requests and help solve the issue.
 */
export class MetadataTelemetryError extends Error {
  public constructor(public readonly originalError: Error, public readonly executionId: string) {
    super(originalError.message);
  }
}

/**
 * If a single entity failed to update, we don't block the other entities from uploading.
 * We still attempt to update the data in the stores as much as possible.
 * Because of that, we keep track of any errors encountered and throw this generic error.
 * It contains that list of encountered errors to present to the user.
 */
export class MetadataUploadError extends Error {
  public constructor(public readonly errors: Error[]) {
    super(
      `Store configuration upload encountered ${
        errors.length === 1 ? 'an error' : `${errors.length} errors`
      }.`
    );
  }
}

/**
 * If a single entity failed to download, we don't block the other entities from downloading.
 * We still attempt to pull in the data from the stores as much as possible.
 * Because of that, we keep track of any errors encountered and throw this generic error.
 * It contains that list of encountered errors to present to the user.
 */
export class MetadataDownloadError extends Error {
  public constructor(public readonly errors: Error[]) {
    super(
      `Store configuration download encountered ${
        errors.length === 1 ? 'an error' : `${errors.length} errors`
      }.`
    );
  }
}

/**
 * Handle a thrown metadata error by informing the user what went wrong.
 * If a normal error is thrown, this method will re-throw that error to avoid consuming it.
 */
export function handleMetadataError(thrownError: Error): void {
  const error =
    thrownError instanceof MetadataTelemetryError ? thrownError.originalError : thrownError;

  if (error instanceof MetadataValidationError) {
    Log.newLine();
    Log.error(chalk.bold(error.message));
    if (error.errors?.length > 0) {
      Log.log(error.errors.map(err => `  - ${err.dataPath} ${err.message}`).join('\n'));
    }
    return;
  }

  if (error instanceof MetadataDownloadError || error instanceof MetadataUploadError) {
    Log.newLine();
    Log.error(chalk.bold(error.message));
    if (error.errors?.length > 0) {
      Log.newLine();
      Log.error(error.errors.map(err => err.message).join('\n\n'));
    }
    Log.newLine();
    Log.log('Please check the logs for any configuration issues.');
    Log.log('If this issue persists, please open a new issue at:');
    // TODO: add execution ID to the issue template link
    Log.log(link('https://github.com/expo/eas-cli'));
    return;
  }

  throw error;
}
