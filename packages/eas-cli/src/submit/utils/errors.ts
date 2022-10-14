import { SubmissionError } from '../../graphql/generated';
import Log from '../../log';

const UNKNOWN_ERROR_CODES = [
  'SUBMISSION_SERVICE_ANDROID_UNKNOWN_ERROR',
  'SUBMISSION_SERVICE_IOS_UNKNOWN_ERROR',
];

/**
 * Returns a boolean indicating whether the submission logs should be printed.
 */
export function printSubmissionError(error: SubmissionError): boolean {
  Log.addNewLineIfNone();
  if (!error.message || (error.errorCode && UNKNOWN_ERROR_CODES.includes(error.errorCode))) {
    Log.error(error.message ?? `We couldn't figure out what went wrong. See logs to learn more.`);
    return true;
  } else {
    Log.error(error.message);
    return false;
  }
}
