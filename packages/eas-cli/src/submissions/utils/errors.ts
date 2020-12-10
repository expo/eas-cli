import log, { learnMore } from '../../log';
import { SubmissionError } from '../SubmissionService.types';

enum SubmissionErrorCode {
  ARCHIVE_DOWNLOAD_NOT_FOUND_ERROR = 'SUBMISSION_SERVICE_COMMON_ARCHIVE_DOWNLOAD_NOT_FOUND_ERROR',
  ARCHIVE_DOWNLOAD_FORBIDDEN_ERROR = 'SUBMISSION_SERVICE_COMMON_ARCHIVE_DOWNLOAD_FORBIDDEN_ERROR',
  ANDROID_UNKNOWN_ERROR = 'SUBMISSION_SERVICE_ANDROID_UNKNOWN_ERROR',
  ANDROID_FIRST_UPLOAD_ERROR = 'SUBMISSION_SERVICE_ANDROID_FIRST_UPLOAD_ERROR',
  ANDROID_OLD_VERSION_CODE_ERROR = 'SUBMISSION_SERVICE_ANDROID_OLD_VERSION_CODE_ERROR',
  ANDROID_MISSING_PRIVACY_POLICY = 'SUBMISSION_SERVICE_ANDROID_MISSING_PRIVACY_POLICY',
  IOS_OLD_VERSION_CODE_ERROR = 'SUBMISSION_SERVICE_IOS_OLD_VERSION_CODE_ERROR',
  IOS_UNKNOWN_ERROR = 'SUBMISSION_SERVICE_IOS_UNKNOWN_ERROR',
  IOS_MISSING_APP_ICON = 'SUBMISSION_SERVICE_IOS_MISSING_APP_ICON',
  IOS_INVALID_SIGNATURE = 'SUBMISSION_SERVICE_IOS_INVALID_SIGNATURE',
}

const SubmissionErrorMessages: Record<SubmissionErrorCode, string> = {
  [SubmissionErrorCode.ARCHIVE_DOWNLOAD_NOT_FOUND_ERROR]:
    "Failed to download the archive file (Response code: 404 Not Found). Please make sure the URL you've provided is correct.",
  [SubmissionErrorCode.ARCHIVE_DOWNLOAD_FORBIDDEN_ERROR]:
    'Failed to download the archive file (Response code: 403 Forbidden). This is most probably caused by trying to upload an expired build artifact. All Expo build artifacts expire after 30 days.',
  [SubmissionErrorCode.ANDROID_UNKNOWN_ERROR]:
    "We couldn't figure out what went wrong. Please see logs to learn more.",
  [SubmissionErrorCode.ANDROID_FIRST_UPLOAD_ERROR]:
    "You haven't submitted this app to Google Play Store yet. The first submission of the app needs to be performed manually.\n" +
    `${learnMore('https://expo.fyi/first-android-submission')}.`,
  [SubmissionErrorCode.ANDROID_OLD_VERSION_CODE_ERROR]:
    "You've already submitted this version of the app.\n" +
    'Versions are identified by Android version code (expo.android.versionCode in app.json).\n' +
    "If you're submitting a managed Expo project, increment the version code in app.json and build the project with expo build:android.\n" +
    `${learnMore('https://expo.fyi/bumping-android-version-code')}.`,
  [SubmissionErrorCode.ANDROID_MISSING_PRIVACY_POLICY]:
    'The app has permissions that require a privacy policy set for the app.\n' +
    `${learnMore('https://expo.fyi/missing-privacy-policy')}.`,
  [SubmissionErrorCode.IOS_OLD_VERSION_CODE_ERROR]:
    "You've already submitted this version of the app.\n" +
    'Versions are identified by Build Numbers (expo.ios.buildNumber in app.json).\n' +
    "If you're submitting an Expo project built with EAS Builds, increment the build number in app.json and build the project again.",
  [SubmissionErrorCode.IOS_UNKNOWN_ERROR]:
    "We couldn't figure out what went wrong. Please see logs to learn more.",
  [SubmissionErrorCode.IOS_MISSING_APP_ICON]:
    'Your iOS App Icon is missing or has invalid format. The icon must be a 1024x1024 PNG image.\n' +
    'Please check your icon image and icon configuration in app.json.\n' +
    `${learnMore('https://docs.expo.io/guides/app-icons/')}`,
  [SubmissionErrorCode.IOS_INVALID_SIGNATURE]:
    'Your app signature seems to be invalid.\n' +
    "Please check your iOS Distribution Certificate and your app's Provisioning Profile.\n" +
    `${learnMore('https://docs.expo.io/distribution/app-signing')}`,
};

export function printSubmissionError(error: SubmissionError): boolean {
  if ((Object.values(SubmissionErrorCode) as string[]).includes(error.errorCode)) {
    const errorCode = error.errorCode as SubmissionErrorCode;
    log.addNewLineIfNone();
    log.error(SubmissionErrorMessages[errorCode]);
    return [SubmissionErrorCode.ANDROID_UNKNOWN_ERROR, SubmissionErrorCode.IOS_UNKNOWN_ERROR].some(
      code => code === errorCode
    );
  } else {
    log(error.message);
    return true;
  }
}
