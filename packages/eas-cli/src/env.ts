export default {
  /**
   * Dangerous overrides, use only if you know what you are doing
   */

  /**
   * Overrides applicationId from Android project, setting this option will also
   * ignore failures when parsing build.gradle.
   */
  overrideAndroidApplicationId: process.env.EAS_DANGEROUS_OVERRIDE_ANDROID_APPLICATION_ID,
  /**
   * Overrides bundleIdentifier from Xcode project for bare workflow.
   * Setting this option will ignore failures thrown when bundle identifier can't be obtained from Xcode project.
   */
  overrideIosBundleIdentifier: process.env.EAS_DANGEROUS_OVERRIDE_IOS_BUNDLE_IDENTIFIER,
  /**
   * Comma separated list of feature gate keys of feature gates to evaluate override to true.
   */
  featureGateEnable: process.env.EAS_FG_ENABLE,
  /**
   * Comma separated list of feature gate keys of feature gates to evaluate override to false.
   */
  featureGateDisable: process.env.EAS_FG_DISABLE,
};
