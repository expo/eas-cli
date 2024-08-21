import chalk from 'chalk';

import { Issue } from './config/issue';
import Log, { link } from '../log';

/**
 * Before syncing data to the ASC API, we need to validate the metadata config.
 * This error represents unrecoverable issues before syncing that data,
 * and should contain useful information for the user to solve before trying again.
 */
export class MetadataValidationError extends Error {
  public constructor(
    message?: string,
    public readonly errors: Issue[] = []
  ) {
    super(message ?? 'Store configuration validation failed');
  }
}

/**
 * If a single entity failed to update, we don't block the other entities from uploading.
 * We still attempt to update the data in the stores as much as possible.
 * Because of that, we keep track of any errors encountered and throw this generic error.
 * It contains that list of encountered errors to present to the user.
 */
export class MetadataUploadError extends Error {
  public constructor(
    public readonly errors: Error[],
    public readonly executionId: string
  ) {
    super(
      `Store configuration upload encountered ${
        errors.length === 1 ? 'an error' : `${errors.length} errors`
      }.`
    );
  }
}

/**
 * If a single entity failed to download, we don't block the other entities from downloading.
 * We sill attempt to pull in the data from the stores as much as possible.
 * Because of that, we keep track of any errors envountered and throw this generic error.
 * It contains that list of encountered errors to present to the user.
 */
export class MetadataDownloadError extends Error {
  public constructor(
    public readonly errors: Error[],
    public readonly executionId: string
  ) {
    super(
      `Store configuration download encountered ${
        errors.length === 1 ? 'an error' : `${errors.length} errors`
      }.`
    );
  }
}

/**
 * Log the encountered metadata validation error in detail for the user.
 * This should help communicate any possible configuration error and help the user resolve it.
 */
export function logMetadataValidationError(error: MetadataValidationError): void {
  Log.newLine();
  Log.error(chalk.bold(error.message));
  if (error.errors?.length > 0) {
    // TODO(cedric): group errors by property to make multiple errors for same property more readable
    for (const err of error.errors) {
      Log.log(`  - ${chalk.bold(`$.${err.path.join('.')}`)} ${err.message}`);
    }
  }
}

/**
 * Handle a thrown metadata error by informing the user what went wrong.
 * If a normal error is thrown, this method will re-throw that error to avoid consuming it.
 */
export function handleMetadataError(error: Error): void {
  if (error instanceof MetadataValidationError) {
    logMetadataValidationError(error);
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
    Log.log('Check the logs for any configuration issues.');
    Log.log('If this issue persists, open a new issue at:');
    // TODO: add execution ID to the issue template link
    Log.log(link('https://github.com/expo/eas-cli'));
    return;
  }

  throw error;
}
