export enum BuildPhase {
  UNKNOWN = 'UNKNOWN',
  QUEUE = 'QUEUE',
  SPIN_UP_BUILDER = 'SPIN_UP_BUILDER',
  BUILDER_INFO = 'BUILDER_INFO',
  READ_APP_CONFIG = 'READ_APP_CONFIG',
  READ_EAS_JSON = 'READ_EAS_JSON',
  READ_PACKAGE_JSON = 'READ_PACKAGE_JSON',
  RUN_EXPO_DOCTOR = 'RUN_EXPO_DOCTOR',
  SET_UP_BUILD_ENVIRONMENT = 'SET_UP_BUILD_ENVIRONMENT',
  START_BUILD = 'START_BUILD',
  INSTALL_CUSTOM_TOOLS = 'INSTALL_CUSTOM_TOOLS',
  PREPARE_PROJECT = 'PREPARE_PROJECT',
  RESTORE_CACHE = 'RESTORE_CACHE',
  INSTALL_DEPENDENCIES = 'INSTALL_DEPENDENCIES',
  EAS_BUILD_INTERNAL = 'EAS_BUILD_INTERNAL',
  PREBUILD = 'PREBUILD',
  PREPARE_CREDENTIALS = 'PREPARE_CREDENTIALS',
  CALCULATE_EXPO_UPDATES_RUNTIME_VERSION = 'CALCULATE_EXPO_UPDATES_RUNTIME_VERSION',
  CONFIGURE_EXPO_UPDATES = 'CONFIGURE_EXPO_UPDATES',
  EAGER_BUNDLE = 'EAGER_BUNDLE',
  SAVE_CACHE = 'SAVE_CACHE',
  CACHE_STATS = 'CACHE_STATS',
  /**
   * @deprecated
   */
  UPLOAD_ARTIFACTS = 'UPLOAD_ARTIFACTS',
  UPLOAD_APPLICATION_ARCHIVE = 'UPLOAD_APPLICATION_ARCHIVE',
  UPLOAD_BUILD_ARTIFACTS = 'UPLOAD_BUILD_ARTIFACTS',
  PREPARE_ARTIFACTS = 'PREPARE_ARTIFACTS',
  CLEAN_UP_CREDENTIALS = 'CLEAN_UP_CREDENTIALS',
  COMPLETE_BUILD = 'COMPLETE_BUILD',
  FAIL_BUILD = 'FAIL_BUILD',

  // ANDROID
  FIX_GRADLEW = 'FIX_GRADLEW',
  RUN_GRADLEW = 'RUN_GRADLEW',

  // IOS
  INSTALL_PODS = 'INSTALL_PODS',
  CONFIGURE_XCODE_PROJECT = 'CONFIGURE_XCODE_PROJECT',
  RUN_FASTLANE = 'RUN_FASTLANE',

  // HOOKS
  PRE_INSTALL_HOOK = 'PRE_INSTALL_HOOK',
  POST_INSTALL_HOOK = 'POST_INSTALL_HOOK',
  PRE_UPLOAD_ARTIFACTS_HOOK = 'PRE_UPLOAD_ARTIFACTS_HOOK',
  ON_BUILD_SUCCESS_HOOK = 'ON_BUILD_SUCCESS_HOOK',
  ON_BUILD_ERROR_HOOK = 'ON_BUILD_ERROR_HOOK',
  ON_BUILD_COMPLETE_HOOK = 'ON_BUILD_COMPLETE_HOOK',
  ON_BUILD_CANCEL_HOOK = 'ON_BUILD_CANCEL_HOOK',

  // RESIGN
  DOWNLOAD_APPLICATION_ARCHIVE = 'DOWNLOAD_APPLICATION_ARCHIVE',

  // CUSTOM BUILDS
  PARSE_CUSTOM_WORKFLOW_CONFIG = 'PARSE_CUSTOM_WORKFLOW_CONFIG',
  CUSTOM = 'CUSTOM',
  COMPLETE_JOB = 'COMPLETE_JOB',
}

export enum SubmissionPhase {
  SPIN_UP_SUBMISSION_WORKER = 'SPIN_UP_SUBMISSION_WORKER',
  SUBMIT_TO_PLAY_STORE = 'SUBMIT_TO_PLAY_STORE',
  SUBMIT_TO_APP_STORE = 'SUBMIT_TO_APP_STORE',
  FAIL_SUBMISSION = 'FAIL_SUBMISSION',
}

export const buildPhaseDisplayName: Record<BuildPhase, string> = {
  [BuildPhase.UNKNOWN]: 'Unknown build phase',
  [BuildPhase.QUEUE]: 'Waiting to start',
  [BuildPhase.SPIN_UP_BUILDER]: 'Spin up build environment',
  [BuildPhase.SET_UP_BUILD_ENVIRONMENT]: 'Set up build environment',
  [BuildPhase.BUILDER_INFO]: 'Builder environment info',
  [BuildPhase.START_BUILD]: 'Start build',
  [BuildPhase.INSTALL_CUSTOM_TOOLS]: 'Install custom tools',
  [BuildPhase.PREPARE_PROJECT]: 'Prepare project',
  [BuildPhase.RESTORE_CACHE]: 'Restore cache',
  [BuildPhase.INSTALL_DEPENDENCIES]: 'Install dependencies',
  [BuildPhase.EAS_BUILD_INTERNAL]: 'Resolve build configuration',
  [BuildPhase.PREBUILD]: 'Prebuild',
  [BuildPhase.PREPARE_CREDENTIALS]: 'Prepare credentials',
  [BuildPhase.CALCULATE_EXPO_UPDATES_RUNTIME_VERSION]: 'Calculate expo-updates runtime version',
  [BuildPhase.CONFIGURE_EXPO_UPDATES]: 'Configure expo-updates',
  [BuildPhase.EAGER_BUNDLE]: 'Bundle JavaScript',
  [BuildPhase.SAVE_CACHE]: 'Save cache',
  [BuildPhase.CACHE_STATS]: 'Cache stats',
  [BuildPhase.UPLOAD_ARTIFACTS]: 'Upload artifacts',
  [BuildPhase.UPLOAD_APPLICATION_ARCHIVE]: 'Upload application archive',
  [BuildPhase.UPLOAD_BUILD_ARTIFACTS]: 'Upload build artifacts',
  [BuildPhase.PREPARE_ARTIFACTS]: 'Prepare artifacts',
  [BuildPhase.CLEAN_UP_CREDENTIALS]: 'Clean up credentials',
  [BuildPhase.COMPLETE_BUILD]: 'Complete build',
  [BuildPhase.FAIL_BUILD]: 'Fail job',
  [BuildPhase.READ_APP_CONFIG]: 'Read app config',
  [BuildPhase.READ_PACKAGE_JSON]: 'Read package.json',
  [BuildPhase.READ_EAS_JSON]: 'Read eas.json',
  [BuildPhase.RUN_EXPO_DOCTOR]: 'Run expo doctor',
  [BuildPhase.DOWNLOAD_APPLICATION_ARCHIVE]: 'Download application archive',

  // ANDROID
  [BuildPhase.FIX_GRADLEW]: 'Fix gradlew',
  [BuildPhase.RUN_GRADLEW]: 'Run gradlew',

  // IOS
  [BuildPhase.INSTALL_PODS]: 'Install pods',
  [BuildPhase.CONFIGURE_XCODE_PROJECT]: 'Configure Xcode project',
  [BuildPhase.RUN_FASTLANE]: 'Run fastlane',

  // HOOKS
  [BuildPhase.PRE_INSTALL_HOOK]: 'Pre-install hook',
  [BuildPhase.POST_INSTALL_HOOK]: 'Post-install hook',
  [BuildPhase.PRE_UPLOAD_ARTIFACTS_HOOK]: 'Pre-upload-artifacts hook',
  [BuildPhase.ON_BUILD_SUCCESS_HOOK]: 'Build success hook',
  [BuildPhase.ON_BUILD_ERROR_HOOK]: 'Build error hook',
  [BuildPhase.ON_BUILD_COMPLETE_HOOK]: 'Build complete hook',
  [BuildPhase.ON_BUILD_CANCEL_HOOK]: 'Build cancel hook',

  // CUSTOM
  [BuildPhase.CUSTOM]: 'Unknown build phase',
  [BuildPhase.PARSE_CUSTOM_WORKFLOW_CONFIG]: 'Parse custom build config',
  [BuildPhase.COMPLETE_JOB]: 'Complete job',
};

export const submissionPhaseDisplayName: Record<SubmissionPhase, string> = {
  [SubmissionPhase.SPIN_UP_SUBMISSION_WORKER]: 'Spin up submission worker',
  [SubmissionPhase.SUBMIT_TO_PLAY_STORE]: 'Submit to Play Store',
  [SubmissionPhase.SUBMIT_TO_APP_STORE]: 'Submit to App Store',
  [SubmissionPhase.FAIL_SUBMISSION]: 'Fail submission',
};

export const buildPhaseWebsiteId: Record<BuildPhase, string> = {
  [BuildPhase.UNKNOWN]: 'unknown',
  [BuildPhase.QUEUE]: 'waiting-to-start',
  [BuildPhase.SPIN_UP_BUILDER]: 'spin-up-build-environment',
  [BuildPhase.SET_UP_BUILD_ENVIRONMENT]: 'set-up-build-environment',
  [BuildPhase.BUILDER_INFO]: 'builder-environment-info',
  [BuildPhase.START_BUILD]: 'start-build',
  [BuildPhase.INSTALL_CUSTOM_TOOLS]: 'install-custom-tools',
  [BuildPhase.PREPARE_PROJECT]: 'prepare-project',
  [BuildPhase.RESTORE_CACHE]: 'restore-cache',
  [BuildPhase.INSTALL_DEPENDENCIES]: 'install-dependencies',
  [BuildPhase.EAS_BUILD_INTERNAL]: 'resolve-build-configuration',
  [BuildPhase.PREBUILD]: 'prebuild',
  [BuildPhase.PREPARE_CREDENTIALS]: 'prepare-credentials',
  [BuildPhase.CALCULATE_EXPO_UPDATES_RUNTIME_VERSION]: 'calculate-expo-updates-runtime-version',
  [BuildPhase.CONFIGURE_EXPO_UPDATES]: 'configure-expo-updates',
  [BuildPhase.EAGER_BUNDLE]: 'eager-bundle',
  [BuildPhase.SAVE_CACHE]: 'save-cache',
  [BuildPhase.CACHE_STATS]: 'cache-stats',
  [BuildPhase.UPLOAD_ARTIFACTS]: 'upload-artifacts',
  [BuildPhase.UPLOAD_APPLICATION_ARCHIVE]: 'upload-application-archive',
  [BuildPhase.UPLOAD_BUILD_ARTIFACTS]: 'upload-build-artifacts',
  [BuildPhase.PREPARE_ARTIFACTS]: 'prepare-artifacts',
  [BuildPhase.CLEAN_UP_CREDENTIALS]: 'clean-up-credentials',
  [BuildPhase.COMPLETE_BUILD]: 'complete-build',
  [BuildPhase.FAIL_BUILD]: 'fail-build',
  [BuildPhase.READ_APP_CONFIG]: 'read-app-config',
  [BuildPhase.READ_PACKAGE_JSON]: 'read-package-json',
  [BuildPhase.READ_EAS_JSON]: 'read-eas-json',
  [BuildPhase.RUN_EXPO_DOCTOR]: 'run-expo-doctor',
  [BuildPhase.DOWNLOAD_APPLICATION_ARCHIVE]: 'download-application-archive',

  // ANDROID
  [BuildPhase.FIX_GRADLEW]: 'fix-gradlew',
  [BuildPhase.RUN_GRADLEW]: 'run-gradlew',

  // IOS
  [BuildPhase.INSTALL_PODS]: 'install-pods',
  [BuildPhase.CONFIGURE_XCODE_PROJECT]: 'configure-xcode-project',
  [BuildPhase.RUN_FASTLANE]: 'run-fastlane',

  // HOOKS
  [BuildPhase.PRE_INSTALL_HOOK]: 'pre-install-hook',
  [BuildPhase.POST_INSTALL_HOOK]: 'post-install-hook',
  [BuildPhase.PRE_UPLOAD_ARTIFACTS_HOOK]: 'pre-upload-artifacts-hook',
  [BuildPhase.ON_BUILD_SUCCESS_HOOK]: 'build-success-hook',
  [BuildPhase.ON_BUILD_ERROR_HOOK]: 'build-error-hook',
  [BuildPhase.ON_BUILD_COMPLETE_HOOK]: 'build-complete-hook',
  [BuildPhase.ON_BUILD_CANCEL_HOOK]: 'build-cancel-hook',

  // CUSTOM
  [BuildPhase.CUSTOM]: 'custom',
  [BuildPhase.PARSE_CUSTOM_WORKFLOW_CONFIG]: 'parse-custom-workflow-config',
  [BuildPhase.COMPLETE_JOB]: 'complete-job',
};

export const submissionPhaseWebsiteId: Record<SubmissionPhase, string> = {
  [SubmissionPhase.SPIN_UP_SUBMISSION_WORKER]: 'spin-up-submission-worker',
  [SubmissionPhase.SUBMIT_TO_PLAY_STORE]: 'submit-to-play-store',
  [SubmissionPhase.SUBMIT_TO_APP_STORE]: 'submit-to-app-store',
  [SubmissionPhase.FAIL_SUBMISSION]: 'fail-submission',
};

export const XCODE_LOGS_BUILD_PHASE_WEBSITE_ID = 'xcode-logs';

export enum BuildPhaseResult {
  SUCCESS = 'success',
  FAIL = 'failed',
  WARNING = 'warning',
  SKIPPED = 'skipped',
  UNKNOWN = 'unknown',
}

export enum LogMarker {
  START_PHASE = 'START_PHASE',
  END_PHASE = 'END_PHASE',
}
