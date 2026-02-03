export const EasBuildGradle = `// Build integration with EAS

import java.nio.file.Paths

def versionCodeFromEnv = System.getenv("EAS_BUILD_ANDROID_VERSION_CODE")
def versionNameFromEnv = System.getenv("EAS_BUILD_ANDROID_VERSION_NAME")

android {
  defaultConfig {
    if (versionCodeFromEnv) {
      versionCode = Integer.parseInt(versionCodeFromEnv)
    }
    if (versionNameFromEnv) {
      versionName = versionNameFromEnv
    }
  }
  applicationVariants.all { variant ->
    variant.outputs.each { output ->
      if (versionCodeFromEnv) {
        output.versionCodeOverride = Integer.parseInt(versionCodeFromEnv)
      }
      if (versionNameFromEnv) {
        output.versionNameOverride = versionNameFromEnv
      }
    }
  }
  signingConfigs {
    release {
      def credentialsJson = Paths.get(System.getenv("EAS_BUILD_WORKINGDIR")).resolve("credentials.json").toFile();
      def credentials = new groovy.json.JsonSlurper().parse(credentialsJson)
      def keystorePath = Paths.get(credentials.android.keystore.keystorePath);

      storeFile keystorePath.toFile()
      storePassword credentials.android.keystore.keystorePassword
      keyAlias credentials.android.keystore.keyAlias
      if (credentials.android.keystore.containsKey("keyPassword")) {
        keyPassword credentials.android.keystore.keyPassword
      } else {
        // key password is required by Gradle, but PKCS keystores don't have one
        // using the keystore password seems to satisfy the requirement
        keyPassword credentials.android.keystore.keystorePassword
      }
    }
  }

  buildTypes {
    release {
      signingConfig android.signingConfigs.release
    }
    debug {
      signingConfig android.signingConfigs.release
    }
  }
}`;
