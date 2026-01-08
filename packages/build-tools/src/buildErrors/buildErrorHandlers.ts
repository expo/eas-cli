import { BuildPhase, Platform } from '@expo/eas-build-job';
import escapeRegExp from 'lodash/escapeRegExp';

import { ErrorContext, ErrorHandler } from './errors.types';

export class TrackedBuildError extends Error {
  constructor(
    public errorCode: string,
    public message: string
  ) {
    super(message);
  }
}

export const buildErrorHandlers: ErrorHandler<TrackedBuildError>[] = [
  {
    platform: Platform.IOS,
    phase: BuildPhase.INSTALL_PODS,
    // example log:
    // CDN: trunk URL couldn't be downloaded: https://cdn.jsdelivr.net/cocoa/Specs/2/a/e/MultiplatformBleAdapter/0.0.3/MultiplatformBleAdapter.podspec.json Response: 429 429: Too Many Requests
    regexp: /CDN: trunk URL couldn't be downloaded.* Response: 429 429: Too Many Requests/,
    createError: () =>
      new TrackedBuildError('COCOAPODS_TO_MANY_REQUEST', 'cocoapods: too many requests'),
  },
  {
    phase: BuildPhase.INSTALL_DEPENDENCIES,
    // Host key verification failed.
    // fatal: Could not read from remote repository.
    regexp: /Host key verification failed\.\nfatal: Could not read from remote repository/,
    createError: () => new TrackedBuildError('NPM_INSTALL_SSH_AUTHENTICATION', 'Missing ssh key.'),
  },
  {
    phase: BuildPhase.INSTALL_DEPENDENCIES,
    // error functions@1.0.0: The engine "node" is incompatible with this module. Expected version "14". Got "16.13.2"
    // error Found incompatible module.
    regexp: /The engine "node" is incompatible with this module\. Expected version/,
    createError: () =>
      new TrackedBuildError('NODE_ENGINE_INCOMPATIBLE', 'node: Incompatible engine field.'),
  },
  {
    phase: BuildPhase.INSTALL_DEPENDENCIES,
    // error An unexpected error occurred: "https://registry.yarnpkg.com/@react-native/normalize-color/-/normalize-color-2.0.0.tgz: Request failed \"500 Internal Server Error\"".
    // or
    // error An unexpected error occurred: "https://registry.yarnpkg.com/request/-/request-2.88.2.tgz: Request failed \"503 Service Unavailable\"".
    regexp: /An unexpected error occurred: "https:\/\/registry.yarnpkg.com\/.*Request failed \\"5/,
    createError: () => new TrackedBuildError('YARN_REGISTRY_5XX_RESPONSE', 'yarn: 5xx response.'),
  },
  {
    phase: BuildPhase.PREBUILD,
    // Input is required, but Expo CLI is in non-interactive mode
    // or
    // CommandError: Input is required, but 'npx expo' is in non-interactive mode.
    regexp: /Input is required, but .* is in non-interactive mode/,
    createError: () =>
      new TrackedBuildError(
        'EXPO_CLI_INPUT_REQUIRED_ERROR',
        `expo-cli: Input required in non-interactive mode.`
      ),
  },
  {
    platform: Platform.IOS,
    phase: BuildPhase.PREBUILD,
    // [03:03:05] [ios.infoPlist]: withIosInfoPlistBaseMod: GoogleService-Info.plist is empty
    regexp: /withIosInfoPlistBaseMod: GoogleService-Info\.plist is empty/,
    createError: () =>
      new TrackedBuildError(
        'EXPO_CLI_EMPTY_GOOGLE_SERVICES_PLIST_ERROR',
        `expo-cli: Empty GoogleService-Info.plist.`
      ),
  },
  {
    platform: Platform.IOS,
    phase: BuildPhase.PREBUILD,
    // [01:52:04] [ios.xcodeproj]: withIosXcodeprojBaseMod: Path to GoogleService-Info.plist is not defined. Please specify the `expo.ios.googleServicesFile` field in app.json.
    regexp: /withIosXcodeprojBaseMod: Path to GoogleService-Info\.plist is not defined/,
    createError: () =>
      new TrackedBuildError(
        'EXPO_CLI_NOT_DEFINED_GOOGLE_SERVICES_PLIST_ERROR',
        `expo-cli: Path to GoogleService-Info.plist is not defined.`
      ),
  },
  {
    phase: BuildPhase.PREBUILD,
    // Error: [android.dangerous]: withAndroidDangerousBaseMod: ENOENT: no such file or directory, open './assets/adaptive-icon.png'
    //     at Object.openSync (node:fs:585:3)
    //     at readFileSync (node:fs:453:35)
    //     at calculateHash (/home/expo/workingdir/build/node_modules/@expo/image-utils/build/Cache.js:14:91)
    //     at createCacheKey (/home/expo/workingdir/build/node_modules/@expo/image-utils/build/Cache.js:19:18)
    //     at Object.createCacheKeyWithDirectoryAsync (/home/expo/workingdir/build/node_modules/@expo/image-utils/build/Cache.js:24:33)
    //     at generateImageAsync (/home/expo/workingdir/build/node_modules/@expo/image-utils/build/Image.js:151:34)
    //     at async generateIconAsync (/home/expo/workingdir/build/node_modules/@expo/prebuild-config/build/plugins/icons/withAndroidIcons.js:369:11)
    //     at async /home/expo/workingdir/build/node_modules/@expo/prebuild-config/build/plugins/icons/withAndroidIcons.js:310:21
    //     at async Promise.all (index 0)
    //     at async generateMultiLayerImageAsync (/home/expo/workingdir/build/node_modules/@expo/prebuild-config/build/plugins/icons/withAndroidIcons.js:306:3)
    //     or
    // Error: [ios.dangerous]: withIosDangerousBaseMod: ENOENT: no such file or directory, open './assets/images/app_icon_staging.png'
    //     at Object.openSync (fs.js:497:3)
    //     at readFileSync (fs.js:393:35)
    //     at calculateHash (/Users/expo/workingdir/build/node_modules/@expo/image-utils/build/Cache.js:14:91)
    //     at createCacheKey (/Users/expo/workingdir/build/node_modules/@expo/image-utils/build/Cache.js:19:18)
    //     at Object.createCacheKeyWithDirectoryAsync (/Users/expo/workingdir/build/node_modules/@expo/image-utils/build/Cache.js:24:33)
    //     at generateImageAsync (/Users/expo/workingdir/build/node_modules/@expo/image-utils/build/Image.js:151:34)
    //     at async setIconsAsync (/Users/expo/workingdir/build/node_modules/@expo/prebuild-config/build/plugins/icons/withIosIcons.js:169:15)
    //     at async /Users/expo/workingdir/build/node_modules/@expo/prebuild-config/build/plugins/icons/withIosIcons.js:71:5
    //     at async action (/Users/expo/workingdir/build/node_modules/@expo/config-plugins/build/plugins/withMod.js:235:23)
    //     at async interceptingMod (/Users/expo/workingdir/build/node_modules/@expo/config-plugins/build/plugins/withMod.js:126:21)
    regexp:
      /ENOENT: no such file or directory[\s\S]*prebuild-config\/build\/plugins\/icons\/with(Android|Ios)Icons\.js/,
    createError: () => new TrackedBuildError('EXPO_CLI_MISSING_ICON', 'expo-cli: Missing icon.'),
  },
  {
    phase: BuildPhase.PREBUILD,
    // Cannot determine which native SDK version your project uses because the module `expo` is not installed. Please install it with `yarn add expo` and try again.
    regexp:
      /Cannot determine which native SDK version your project uses because the module `expo` is not installed/,
    createError: () =>
      new TrackedBuildError('EXPO_CLI_EXPO_PACKAGE_MISSING', 'expo-cli: "expo" package missing.'),
  },
  {
    phase: BuildPhase.INSTALL_PODS,
    // The Swift pod `FirebaseCoreInternal` depends upon `GoogleUtilities`, which does not define modules. To opt into those targets generating module maps (which is necessary to import them from Swift when building as static
    regexp: /The Swift pod .* depends upon .* which does not define modules/,
    createError: () =>
      new TrackedBuildError(
        'SWIFT_POD_INCOMPATIBLE_DEPENDENCY',
        'pod: Swift pod depends on a pod that does not define modules.'
      ),
  },
  {
    platform: Platform.IOS,
    phase: BuildPhase.INSTALL_PODS,
    // Adding spec repo `24-repository-cocoapods-proxy` with CDN `http://10.254.24.7:8081/repository/cocoapods-proxy/`
    // [!] No podspec exists at path `/Users/expo/.cocoapods/repos/24-repository-cocoapods-proxy/Specs/1/9/2/libwebp/1.2.0/libwebp.podspec.json`.
    regexp: /Adding spec repo .* with CDN .*\n\s*\[!\] No podspec exists at path `(.*)`/,
    // Some pods are hosted on git registries that are not supported e.g. chromium.googlesource.com
    createError: (match: RegExpMatchArray) =>
      new TrackedBuildError(
        'COCOAPODS_CACHE_INCOMPATIBLE_REPO_ERROR',
        `cocoapods: Missing podspec ${match[1]}.`
      ),
  },
  {
    platform: Platform.IOS,
    phase: BuildPhase.INSTALL_PODS,
    // [!] Invalid `Podfile` file: 783: unexpected token at 'info Run CLI with --verbose flag for more details.
    regexp:
      /\[!\] Invalid `Podfile` file: .* unexpected token at 'info Run CLI with --verbose flag for more details./,
    createError: () =>
      new TrackedBuildError('NODE_ENV_PRODUCTION_DEFINED', 'npm: NODE_ENV=production was defined.'),
  },
  ...[BuildPhase.INSTALL_DEPENDENCIES, BuildPhase.PREBUILD].map((phase) => ({
    phase,
    // example log:
    // [stderr] WARN tarball tarball data for @typescript-eslint/typescript-estree@5.26.0 (sha512-cozo/GbwixVR0sgfHItz3t1yXu521yn71Wj6PlYCFA3WPhy51CUPkifFKfBis91bDclGmAY45hhaAXVjdn4new==) seems to be corrupted. Trying again.
    regexp: /tarball tarball data for ([^ ]*) .* seems to be corrupted. Trying again/,
    createError: (match: RegExpMatchArray) =>
      new TrackedBuildError('NPM_CORRUPTED_PACKAGE', `npm: corrupted package ${match[1]}`),
  })),
  ...[BuildPhase.INSTALL_DEPENDENCIES, BuildPhase.PREBUILD].map((phase) => ({
    phase,
    regexp: ({ env }: ErrorContext) =>
      env.EAS_BUILD_NPM_CACHE_URL
        ? new RegExp(escapeRegExp(env.EAS_BUILD_NPM_CACHE_URL))
        : undefined,
    createError: () => new TrackedBuildError('NPM_CACHE_ERROR', `npm: cache error`),
  })),
  {
    platform: Platform.IOS,
    phase: BuildPhase.INSTALL_PODS,
    regexp: ({ env }: ErrorContext) =>
      env.EAS_BUILD_COCOAPODS_CACHE_URL ? /Error installing/ : undefined,
    createError: () =>
      new TrackedBuildError(
        'COCOAPODS_CACHE_INSTALLING_POD_ERROR',
        `cocoapods: error installing a pod using internal cache instance`
      ),
  },
  {
    platform: Platform.IOS,
    phase: BuildPhase.INSTALL_PODS,
    regexp: ({ env }: ErrorContext) =>
      env.EAS_BUILD_COCOAPODS_CACHE_URL ? /No podspec exists at path/ : undefined,
    createError: () =>
      new TrackedBuildError(
        'COCOAPODS_CACHE_NO_PODSPEC_EXISTS_AT_PATH_ERROR',
        `cocoapods: error fetching a podspec through internal cache instance`
      ),
  },
  {
    platform: Platform.IOS,
    phase: BuildPhase.INSTALL_PODS,
    regexp: ({ env }: ErrorContext) =>
      env.EAS_BUILD_COCOAPODS_CACHE_URL
        ? new RegExp(escapeRegExp(env.EAS_BUILD_COCOAPODS_CACHE_URL))
        : undefined,
    createError: () => new TrackedBuildError('COCOAPODS_CACHE_ERROR', `cocoapods: cache error`),
  },
  {
    phase: BuildPhase.INSTALL_PODS,
    // [!] Invalid `Podfile` file: uninitialized constant Pod::Podfile::FlipperConfiguration.
    regexp: /\[!\] Invalid `Podfile` file/,
    createError: () => new TrackedBuildError('INVALID_PODFILE', 'pod: Invalid Podfile file.'),
  },
  {
    phase: BuildPhase.INSTALL_DEPENDENCIES,
    // info There appears to be trouble with your network connection. Retrying...
    regexp: /info There appears to be trouble with your network connection. Retrying/,
    createError: () =>
      new TrackedBuildError(
        'YARN_INSTALL_TROUBLE_WITH_NETWORK_CONNECTION',
        'yarn: There appears to be trouble with your network connection'
      ),
  },
  {
    phase: BuildPhase.RUN_GRADLEW,
    platform: Platform.ANDROID,
    // Android Gradle plugin requires Java 11 to run. You are currently using Java 1.8
    regexp: /Android Gradle plugin requires Java .* to run. You are currently using Java/,
    createError: () =>
      new TrackedBuildError('INCOMPATIBLE_JAVA_VERSION', 'gradle: Incompatible java version.'),
  },
  {
    phase: BuildPhase.RUN_GRADLEW,
    platform: Platform.ANDROID,
    // /home/expo/workingdir/build/android/app/src/main/AndroidManifest.xml:27:9-33:20 Error:
    //  	android:exported needs to be explicitly specified for element <activity#androidx.test.core.app.InstrumentationActivityInvoker$EmptyActivity>. Apps targeting Android 12 and higher are required to specify an explicit value for `android:exported` when the corresponding component has an intent filter defined. See https://developer.android.com/guide/topics/manifest/activity-element#exported for details.
    regexp:
      /Apps targeting Android 12 and higher are required to specify an explicit value for `android:exported`/,
    createError: () =>
      new TrackedBuildError(
        'REQUIRE_EXPLICIT_EXPORTED_ANDROID_12',
        'Apps targeting Android 12 and higher are required to specify an explicit value for `android:exported`.'
      ),
  },
  {
    phase: BuildPhase.RUN_GRADLEW,
    platform: Platform.ANDROID,
    // > A failure occurred while executing com.android.build.gradle.internal.res.Aapt2CompileRunnable
    //   > Android resource compilation failed
    //     ERROR:/home/expo/workingdir/build/android/app/src/main/res/mipmap-mdpi/ic_launcher.png: AAPT: error: failed to read PNG signature: file does not start with PNG signature.
    regexp: /AAPT: error: failed to read PNG signature: file does not start with PNG signature/,
    createError: () =>
      new TrackedBuildError('INVALID_PNG_SIGNATURE', 'gradle: Invalid PNG signature.'),
  },
  {
    phase: BuildPhase.RUN_GRADLEW,
    platform: Platform.ANDROID,
    // Execution failed for task ':app:processReleaseGoogleServices'.
    // > Malformed root json
    regexp: /Execution failed for task ':app:process.*GoogleServices'.*\s.*Malformed root json/,
    createError: () =>
      new TrackedBuildError(
        'GRADLE_MALFORMED_GOOGLE_SERVICES_JSON',
        'gradle: Malformed google-services.json.'
      ),
  },
  {
    phase: BuildPhase.RUN_GRADLEW,
    platform: Platform.ANDROID,
    // Execution failed for task ':app:processDebugGoogleServices'.
    // > Missing project_info object
    regexp:
      /Execution failed for task ':app:process.*GoogleServices'.*\s.*Missing project_info object/,
    createError: () =>
      new TrackedBuildError(
        'GRADLE_MALFORMED_GOOGLE_SERVICES_JSON',
        'gradle: Missing project_info object.'
      ),
  },
  {
    phase: BuildPhase.RUN_GRADLEW,
    platform: Platform.ANDROID,
    // Execution failed for task ':app:bundleReleaseJsAndAssets'.
    // > Process 'command 'node'' finished with non-zero exit value 1
    regexp:
      /Execution failed for task ':app:bundleReleaseJsAndAssets'.*\s.*Process 'command 'node'' finished with non-zero exit value/,
    createError: () =>
      new TrackedBuildError(
        'GRADLE_BUILD_BUNDLER_ERROR',
        "gradle: ':app:bundleReleaseJsAndAssets' failed."
      ),
  },
  {
    platform: Platform.ANDROID,
    phase: BuildPhase.RUN_GRADLEW,
    //    > Could not resolve org.jetbrains.kotlin:kotlin-annotation-processing-gradle:1.5.10.
    //      Required by:
    //          project :expo-updates
    //       > Could not resolve org.jetbrains.kotlin:kotlin-annotation-processing-gradle:1.5.10.
    //          > Could not get resource 'https://lsdkfjsdlkjf.com/android/releases/org/jetbrains/kotlin/kotlin-annotation-processing-gradle/1.5.10/kotlin-annotation-processing-gradle-1.5.10.pom'.
    //             > Could not HEAD 'https://slkdfjldskjfl.com/android/releases/org/jetbrains/kotlin/kotlin-annotation-processing-gradle/1.5.10/kotlin-annotation-processing-gradle-1.5.10.pom'.
    //                > Connect to sdlkfjsdlkf.com:443 [slkdfjdslk.com/38.178.101.5] failed: connect timed out
    regexp: /Could not get resource.*\n.*Could not HEAD 'https/,
    createError: () =>
      new TrackedBuildError('MAVEN_REGISTRY_CONNECTION_ERROR', `maven: registry connection error`),
  },
  {
    platform: Platform.ANDROID,
    phase: BuildPhase.RUN_GRADLEW,
    regexp: ({ env }: ErrorContext) =>
      env.EAS_BUILD_MAVEN_CACHE_URL
        ? // The BlurView 2.0.3 jar was removed from jitpack.io
          // and it caused false positive MAVEN_CACHE_ERROR errors being reported.
          new RegExp(
            `^(?!.*Could not find BlurView-version-2\\.0\\.3\\.jar).*${escapeRegExp(
              env.EAS_BUILD_MAVEN_CACHE_URL
            )}`
          )
        : undefined,
    createError: () => new TrackedBuildError('MAVEN_CACHE_ERROR', `maven: cache error`),
  },
  {
    phase: BuildPhase.RUN_FASTLANE,
    platform: Platform.IOS,
    // error: exportArchive: exportOptionsPlist error for key "iCloudContainerEnvironment": expected one of {Development, Production}, but no value was provided
    regexp: /exportArchive: exportOptionsPlist error for key "iCloudContainerEnvironment"/,
    createError: () =>
      new TrackedBuildError(
        'MISSING_ICLOUD_CONTAINER_ENVIRONMENT',
        'fastlane: Missing iCloudContainerEnvironment in exportOptionsPlist.'
      ),
  },
  {
    phase: BuildPhase.RUN_FASTLANE,
    platform: Platform.IOS,
    // The following build commands failed:
    //	PhaseScriptExecution [CP-User]\ Generate\ app.manifest\ for\ expo-updates /Users/expo/Library/Developer/Xcode/DerivedData/Kenkohub-eqseedlxbgrzjqagscbclhbtstwh/Build/Intermediates.noindex/ArchiveIntermediates/Kenkohub/IntermediateBuildFilesPath/Pods.build/Release-iphoneos/EXUpdates.build/Script-BB6B5FD28815C045A20B2E5E3FEEBD6E.sh (in target 'EXUpdates' from project 'Pods')
    regexp:
      /The following build commands failed.*\s.*\[CP-User\]\\ Generate\\ app\.manifest\\ for\\ expo-updates/,
    createError: () =>
      new TrackedBuildError(
        'XCODE_BUILD_UPDATES_PHASE_SCRIPT',
        'fastlane: Generating app.manifest for expo-updates failed.'
      ),
  },
  {
    phase: BuildPhase.RUN_FASTLANE,
    platform: Platform.IOS,
    // The following build commands failed:
    // 	CompileC /Users/expo/Library/Developer/Xcode/DerivedData/Docent-amxxhphjfdtkpxecgidgzvwvnvtc/Build/Intermediates.noindex/ArchiveIntermediates/Docent/IntermediateBuildFilesPath/Pods.build/Release-iphoneos/Flipper-Folly.build/Objects-normal/arm64/SSLErrors.o /Users/expo/workingdir/build/ios/Pods/Flipper-Folly/folly/io/async/ssl/SSLErrors.cpp normal arm64 c++ com.apple.compilers.llvm.clang.1_0.compiler (in target 'Flipper-Folly' from project 'Pods')
    regexp: /in target 'Flipper-Folly' from project 'Pods'/,
    createError: () =>
      new TrackedBuildError(
        'FLIPPER_FOLLY_COMPILE_ERROR',
        'fastlane: Flipper-Folly compile error.'
      ),
  },
  {
    phase: BuildPhase.RUN_FASTLANE,
    platform: Platform.IOS,
    // The following build commands failed:
    //	PhaseScriptExecution Bundle\ React\ Native\ code\ and\ images /Users/expo/Library/Developer/Xcode/DerivedData/cnaxwpahkhcjluhigkcwrturapmm/Build/Intermediates.noindex/ArchiveIntermediates/Test/IntermediateBuildFilesPath/Test.build/Release-iphoneos/Test.build/Script-00DD1BFF151E006B06BC.sh (in target 'Test' from project 'Test')
    regexp:
      /The following build commands failed.*\s.*PhaseScriptExecution Bundle\\ React\\ Native\\ code\\ and\\ images \/Users\/expo/,
    createError: () =>
      new TrackedBuildError(
        'XCODE_BUILD_BUNDLER_ERROR',
        'fastlane: Bundle React Native code and images failed.'
      ),
  },
];
