export default {
  /**
   * Dangerous overrides, use only if you know what you are doing
   */

  /**
   * Overrides applicationId from Android project, setting this option will also
   * ignore failures when parsing build.gradle.
   */
  overrideAndroidApplicationId: process.env.EAS_DANGEROUS_OVERRIDE_ANDROID_APPLICATION_ID,
};
