import { SubmissionError } from '../../graphql/generated';
import Log, { learnMore } from '../../log';

enum SubmissionErrorCode {
  ARCHIVE_DOWNLOAD_NOT_FOUND_ERROR = 'SUBMISSION_SERVICE_COMMON_ARCHIVE_DOWNLOAD_NOT_FOUND_ERROR',
  ARCHIVE_DOWNLOAD_FORBIDDEN_ERROR = 'SUBMISSION_SERVICE_COMMON_ARCHIVE_DOWNLOAD_FORBIDDEN_ERROR',
  ARCHIVE_EXTRACT_NO_FILES_FOUND_ERROR = 'SUBMISSION_SERVICE_COMMON_ARCHIVE_EXTRACT_NO_FILES_FOUND_ERROR',
  ARCHIVE_EXTRACT_CORRUPT_ARCHIVE_ERROR = 'SUBMISSION_SERVICE_COMMON_ARCHIVE_EXTRACT_CORRUPT_ARCHIVE_ERROR',
  UPLOAD_TAKING_TOO_LONG_ERROR = 'SUBMISSION_SERVICE_COMMON_UPLOAD_TAKING_TOO_LONG_ERROR',
  ANDROID_UNKNOWN_ERROR = 'SUBMISSION_SERVICE_ANDROID_UNKNOWN_ERROR',
  ANDROID_FIRST_UPLOAD_ERROR = 'SUBMISSION_SERVICE_ANDROID_FIRST_UPLOAD_ERROR',
  ANDROID_OLD_VERSION_CODE_ERROR = 'SUBMISSION_SERVICE_ANDROID_OLD_VERSION_CODE_ERROR',
  ANDROID_MISSING_PRIVACY_POLICY = 'SUBMISSION_SERVICE_ANDROID_MISSING_PRIVACY_POLICY',
  IOS_OLD_VERSION_CODE_ERROR = 'SUBMISSION_SERVICE_IOS_OLD_VERSION_CODE_ERROR',
  IOS_UNKNOWN_ERROR = 'SUBMISSION_SERVICE_IOS_UNKNOWN_ERROR',
  IOS_MISSING_APP_ICON = 'SUBMISSION_SERVICE_IOS_MISSING_APP_ICON',
  IOS_INVALID_SIGNATURE = 'SUBMISSION_SERVICE_IOS_INVALID_SIGNATURE',
  IOS_INCORRECT_CREDENTIALS = 'SUBMISSION_SERVICE_IOS_INVALID_CREDENTIALS',
  IOS_IPAD_INVALID_ORIENTATION = 'SUBMISSION_SERVICE_IOS_IPAD_INVALID_ORIENTATION',
  IOS_APPLE_MAINTENANCE = 'SUBMISSION_SERVICE_IOS_APPLE_MAINTENANCE',
  IOS_INVALID_PROVISIONING_PROFILE_SIGNATURE = 'SUBMISSION_SERVICE_IOS_INVALID_PROVISIONING_PROFILE_SIGNATURE',
  IOS_SIGNED_WITH_ADHOC_PROFILE = 'SUBMISSION_SERVICE_IOS_SIGNED_WITH_ADHOC_PROFILE',
}

const SubmissionErrorMessages: Record<SubmissionErrorCode, string> = {
  [SubmissionErrorCode.ARCHIVE_DOWNLOAD_NOT_FOUND_ERROR]:
    "Failed to download the archive file (Response code: 404 Not Found). Make sure the URL you've provided is correct.",
  [SubmissionErrorCode.ARCHIVE_DOWNLOAD_FORBIDDEN_ERROR]:
    'Failed to download the archive file (Response code: 403 Forbidden). This is most probably caused by trying to upload an expired build artifact. All EAS build artifacts expire after 30 days.',
  [SubmissionErrorCode.ARCHIVE_EXTRACT_CORRUPT_ARCHIVE_ERROR]:
    'The compressed archive is corrupt, in an unsupported format, or contains an invalid application format. Supported files include .apk, .aab, and .ipa files and one of these files compressed into a .tar.gz archive.',
  [SubmissionErrorCode.ARCHIVE_EXTRACT_NO_FILES_FOUND_ERROR]:
    "EAS Submit couldn't find a valid build artifact within provided compressed archive.\n" +
    'If you provide a tar.gz archive, it should contain at least one .apk/.aab/.ipa file, depending on the submission platform.',
  [SubmissionErrorCode.ANDROID_UNKNOWN_ERROR]:
    "We couldn't figure out what went wrong. See logs to learn more.",
  [SubmissionErrorCode.ANDROID_FIRST_UPLOAD_ERROR]:
    "You haven't submitted this app to Google Play Store yet. The first submission of the app needs to be performed manually.\n" +
    `${learnMore('https://expo.fyi/first-android-submission')}.`,
  [SubmissionErrorCode.ANDROID_OLD_VERSION_CODE_ERROR]:
    "You've already submitted this version of the app.\n" +
    'Versions are identified by Android version code (expo.android.versionCode in app.json).\n' +
    "If you're submitting a managed Expo project, increment the version code in app.json and build the project with eas build.\n" +
    `${learnMore('https://expo.fyi/bumping-android-version-code')}.`,
  [SubmissionErrorCode.ANDROID_MISSING_PRIVACY_POLICY]:
    'The app has permissions that require a privacy policy set for the app.\n' +
    `${learnMore('https://expo.fyi/missing-privacy-policy')}.`,
  [SubmissionErrorCode.IOS_OLD_VERSION_CODE_ERROR]:
    "You've already submitted this version of the app.\n" +
    'Versions are identified by Build Numbers (expo.ios.buildNumber in app.json).\n' +
    "If you're submitting an Expo project built with EAS Build, increment the build number in app.json and build the project again.\n" +
    `${learnMore('https://expo.fyi/bumping-ios-build-number')}.`,
  [SubmissionErrorCode.IOS_UNKNOWN_ERROR]:
    "We couldn't figure out what went wrong. See logs to learn more.",
  [SubmissionErrorCode.IOS_MISSING_APP_ICON]:
    'Your iOS app icon is missing or is an invalid format. The icon must be a 1024x1024 PNG image with no transparency.\n' +
    'Check your icon image and icon configuration in app.json.\n' +
    `${learnMore('https://docs.expo.dev/guides/app-icons/')}`,
  [SubmissionErrorCode.IOS_INVALID_SIGNATURE]:
    'Your app signature seems to be invalid.\n' +
    "Check your iOS Distribution Certificate and your app's Provisioning Profile.\n" +
    `${learnMore('https://docs.expo.dev/distribution/app-signing')}`,
  [SubmissionErrorCode.IOS_INCORRECT_CREDENTIALS]:
    'Your Apple ID or app-specific password is incorrect. Verify that you entered them correctly and try again.',
  [SubmissionErrorCode.IOS_IPAD_INVALID_ORIENTATION]:
    "Your app doesn't support iPad multitasking and has to require full screen.\n" +
    "If you're submitting a managed Expo project, set the `expo.ios.requireFullScreen` to true in app.json and build the project again.\n" +
    `${learnMore('https://expo.fyi/ipad-requires-fullscreen')}`,
  [SubmissionErrorCode.IOS_APPLE_MAINTENANCE]:
    'It looks like Apple servers are undergoing an unscheduled maintenance. Try again later.',
  [SubmissionErrorCode.IOS_INVALID_PROVISIONING_PROFILE_SIGNATURE]:
    'Invalid Provisioning Profile Signature (ITMS-90165)\n' +
    "Some of Apple's certificates have expired.\n" +
    'Delete your Provisioning Profile from your account. Then rebuild the app interactively to generate a new one, and try submitting it to the App Store again.',
  [SubmissionErrorCode.UPLOAD_TAKING_TOO_LONG_ERROR]:
    'Submission has reached the timeout limit. Try again.',
  [SubmissionErrorCode.IOS_SIGNED_WITH_ADHOC_PROFILE]:
    'Invalid Provisioning Profile for Apple App Store distribution. The application was signed with an Ad Hoc/Enterprise Provisioning Profile, which is meant for "Internal Distribution". In order to distribute an app on the store, it must be signed with a Distribution Provisioning Profile. Ensure that you are submitting the correct build, or rebuild the application with a Distribution Provisioning Profile and submit that new build.',
};

export function printSubmissionError(error: SubmissionError): boolean {
  if (
    error.errorCode &&
    (Object.values(SubmissionErrorCode) as string[]).includes(error.errorCode)
  ) {
    const errorCode = error.errorCode as SubmissionErrorCode;
    Log.addNewLineIfNone();
    Log.error(SubmissionErrorMessages[errorCode]);
    return [SubmissionErrorCode.ANDROID_UNKNOWN_ERROR, SubmissionErrorCode.IOS_UNKNOWN_ERROR].some(
      code => code === errorCode
    );
  } else {
    Log.log(error.message);
    return true;
  }
}
