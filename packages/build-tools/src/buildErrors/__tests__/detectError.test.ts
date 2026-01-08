import path from 'path';

import { BuildMode, BuildPhase, errors, Job, Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { resolveBuildPhaseErrorAsync } from '../detectError';

jest.mock('fs');
const originalFs = jest.requireActual('fs');

afterEach(() => {
  vol.reset();
});

describe(resolveBuildPhaseErrorAsync, () => {
  it('detects log for corrupted npm package', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [
        '[stderr] WARN tarball tarball data for @typescript-eslint/typescript-estree@5.26.0 (sha512-cozo/GbwixVR0sgfHItz3t1yXu521yn71Wj6PlYCFA3WPhy51CUPkifFKfBis91bDclGmAY45hhaAXVjdn4new==) seems to be corrupted. Trying again.',
      ],
      {
        job: { platform: Platform.ANDROID } as Job,
        phase: BuildPhase.INSTALL_DEPENDENCIES,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('NPM_CORRUPTED_PACKAGE');
    expect(err.userFacingErrorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  });

  it('detects log for invalid bundler and reports it to user', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [
        "/System/Library/Frameworks/Ruby.framework/Versions/2.6/usr/lib/ruby/2.6.0/rubygems/dependency.rb:313:in `to_specs': Could not find 'bundler' (2.2.3) required by your /Users/expo/project/build/ios/Gemfile.lock. (Gem::MissingSpecVersionError)",
      ],
      {
        job: { platform: Platform.IOS } as Job,
        phase: BuildPhase.RUN_FASTLANE,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('EAS_BUILD_UNSUPPORTED_BUNDLER_VERSION_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_UNSUPPORTED_BUNDLER_VERSION_ERROR');
  });

  it('does not detect errors if they show up in different build phase', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [
        "/System/Library/Frameworks/Ruby.framework/Versions/2.6/usr/lib/ruby/2.6.0/rubygems/dependency.rb:313:in `to_specs': Could not find 'bundler' (2.2.3) required by your /Users/expo/project/build/ios/Gemfile.lock. (Gem::MissingSpecVersionError)",
      ],
      {
        job: { platform: Platform.IOS } as Job,
        phase: BuildPhase.INSTALL_DEPENDENCIES, // it should be in RUN_FASTLANE
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
    expect(err.userFacingErrorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  });

  it('detects npm cache error if cache is enabled', async () => {
    const mockEnv = {
      EAS_BUILD_NPM_CACHE_URL: 'https://dominik.sokal.pl/npm/cache',
    };

    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [`Blah blah Error ... ${mockEnv.EAS_BUILD_NPM_CACHE_URL}`],
      {
        job: { platform: Platform.ANDROID } as Job,
        phase: BuildPhase.INSTALL_DEPENDENCIES,
        env: mockEnv,
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('NPM_CACHE_ERROR');
    expect(err.userFacingErrorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  });

  it('does not detect npm cache error if cache is disabled', async () => {
    const mockEnv = {
      EAS_BUILD_NPM_CACHE_URL: 'https://dominik.sokal.pl/npm/cache',
    };

    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [`Blah blah Error ... ${mockEnv.EAS_BUILD_NPM_CACHE_URL}`],
      {
        job: { platform: Platform.ANDROID } as Job,
        phase: BuildPhase.INSTALL_DEPENDENCIES,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
    expect(err.userFacingErrorCode).toBe(errors.ErrorCode.UNKNOWN_ERROR);
  });

  it('detects xcode line error', async () => {
    vol.fromJSON({
      '/path/to/xcodelogs.log': originalFs.readFileSync(
        path.resolve('./src/buildErrors/__tests__/fixtures/xcode.log'),
        'utf-8'
      ),
    });

    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [''],
      {
        job: { platform: Platform.IOS } as Job,
        phase: BuildPhase.RUN_FASTLANE,
        env: {},
      },
      '/path/to/'
    );
    expect(err.errorCode).toBe('XCODE_RESOURCE_BUNDLE_CODE_SIGNING_ERROR');
    expect(err.userFacingErrorCode).toBe('XCODE_RESOURCE_BUNDLE_CODE_SIGNING_ERROR');
  });

  it('detects minimum deployment target error correctly', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [
        'CocoaPods could not find compatible versions for pod "react-native-google-maps":16  In Podfile:17    react-native-google-maps (from `/Users/expo/workingdir/build/node_modules/react-native-maps`)18Specs satisfying the `react-native-google-maps (from `/Users/expo/workingdir/build/node_modules/react-native-maps`)` dependency were found, but they required a higher minimum deployment target.19Error: Compatible versions of some pods could not be resolved.',
      ],
      {
        job: { platform: Platform.IOS } as Job,
        phase: BuildPhase.INSTALL_PODS,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('EAS_BUILD_HIGHER_MINIMUM_DEPLOYMENT_TARGET_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_HIGHER_MINIMUM_DEPLOYMENT_TARGET_ERROR');
  });

  it('detects provisioning profile mismatch error correctly', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [
        `No provisioning profile for application: '_floatsignTemp/Payload/EcoBatteryPREVIEW.app' with bundle identifier 'com.ecobattery.ecobattery-preview'`,
      ],
      {
        job: { platform: Platform.IOS, mode: BuildMode.RESIGN } as Job,
        phase: BuildPhase.RUN_FASTLANE,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('EAS_BUILD_RESIGN_PROVISIONING_PROFILE_MISMATCH_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_RESIGN_PROVISIONING_PROFILE_MISMATCH_ERROR');
  });

  it('detects generic "Run Fastlane" error for resign correctly', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [`other error`],
      {
        job: { platform: Platform.IOS, mode: BuildMode.RESIGN } as Job,
        phase: BuildPhase.RUN_FASTLANE,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('EAS_BUILD_UNKNOWN_FASTLANE_RESIGN_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_UNKNOWN_FASTLANE_RESIGN_ERROR');
  });

  it('detects build error in "Run Fastlane" phase correctly', async () => {
    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [`some build error`],
      {
        job: { platform: Platform.IOS, mode: BuildMode.BUILD } as Job,
        phase: BuildPhase.RUN_FASTLANE,
        env: {},
      },
      '/fake/path'
    );
    expect(err.errorCode).toBe('EAS_BUILD_UNKNOWN_FASTLANE_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_UNKNOWN_FASTLANE_ERROR');
  });

  it('detects provisioning profile mismatch error correctly', async () => {
    const xcodeLogs = `Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/Objects-normal/arm64/82b82416624d2658e5098eb0a28c15c5-common-args.resp
-target arm64-apple-ios15.0-simulator '-std=gnu++14' '-stdlib=libc++' -fmodules '-fmodules-cache-path=/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/ModuleCache.noindex' '-fmodule-name=yoga' -fpascal-strings -Os -fno-common '-DPOD_CONFIGURATION_RELEASE=1' '-DCOCOAPODS=1' -isysroot /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator18.1.sdk -g -iquote /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/Yoga-generated-files.hmap -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/Yoga-own-target-headers.hmap -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/Yoga-all-non-framework-target-headers.hmap -ivfsoverlay /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Pods-8699adb1dd336b26511df848a716bd42-VFS-iphonesimulator/all-product-headers.yaml -iquote /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/Yoga-project-headers.hmap -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/Yoga/include -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/Pods/Headers/Private -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/Pods/Headers/Private/Yoga -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/Pods/Headers/Public -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/Pods/Headers/Public/Yoga -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/DerivedSources-normal/arm64 -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/DerivedSources/arm64 -I/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Intermediates.noindex/Pods.build/Release-iphonesimulator/Yoga.build/DerivedSources -F/Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/Yoga
MkDir /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/expo-dev-menu/EXDevMenu.bundle (in target 'expo-dev-menu-EXDevMenu' from project 'Pods')
    cd /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/Pods
    /bin/mkdir -p /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/expo-dev-menu/EXDevMenu.bundle

MkDir /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/expo-dev-launcher/EXDevLauncher.bundle (in target 'expo-dev-launcher-EXDevLauncher' from project 'Pods')
    cd /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/Pods
    /bin/mkdir -p /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/expo-dev-launcher/EXDevLauncher.bundle

ProcessXCFramework /Users/expo/workingdir/build/packages/video/ios/Vendor/dependency/ProgrammaticAccessLibrary.xcframework /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator/ProgrammaticAccessLibrary.framework ios simulator
    cd /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios
    builtin-process-xcframework --xcframework /Users/expo/workingdir/build/packages/video/ios/Vendor/dependency/ProgrammaticAccessLibrary.xcframework --platform ios --environment simulator --target-path /Users/expo/workingdir/build/packages/apps/NFLNetwork/ios/build/Build/Products/Release-iphonesimulator
/Users/expo/workingdir/build/packages/video/ios/Vendor/dependency/ProgrammaticAccessLibrary.xcframework:1:1: error: The signature of “ProgrammaticAccessLibrary.xcframework” cannot be verified.
    note: A sealed resource is missing or invalid
    note: /Users/expo/workingdir/build/packages/video/ios/Vendor/dependency/ProgrammaticAccessLibrary.xcframework: a sealed resource is missing or invalid
file modified: /Users/expo/workingdir/build/packages/video/ios/Vendor/dependency/ProgrammaticAccessLibrary.xcframework/ios-arm64_x86_64-simulator/ProgrammaticAccessLibrary.framework/ProgrammaticAccessLibrary
file modified: /Users/expo/workingdir/build/packages/video/ios/Vendor/dependency/ProgrammaticAccessLibrary.xcframework/ios-arm64/ProgrammaticAccessLibrary.framework/ProgrammaticAccessLibrary
error: Some other error
log
log
log
error: The last one
log
note`;

    vol.fromJSON({
      '/path/to/xcode.log': xcodeLogs,
    });

    const fakeError = new Error();
    const err = await resolveBuildPhaseErrorAsync(
      fakeError,
      [`some logs`],
      {
        job: { platform: Platform.IOS, mode: BuildMode.BUILD } as Job,
        phase: BuildPhase.RUN_FASTLANE,
        env: {},
      },
      '/path/to'
    );
    expect(err.errorCode).toBe('XCODE_BUILD_ERROR');
    expect(err.userFacingErrorCode).toBe('XCODE_BUILD_ERROR');
    expect(err.userFacingMessage)
      .toBe(`The "Run fastlane" step failed because of an error in the Xcode build process. We automatically detected following errors in your Xcode build logs:
- The signature of “ProgrammaticAccessLibrary.xcframework” cannot be verified.
- Some other error
- The last one
Refer to "Xcode Logs" below for additional, more detailed logs.`);
  });

  it('detects MAVEN_CACHE_ERROR correctly', async () => {
    const err = await resolveBuildPhaseErrorAsync(
      new Error(),
      [`https://szymon.pl/maven/cache`],
      {
        job: { platform: Platform.ANDROID, mode: BuildMode.BUILD } as Job,
        phase: BuildPhase.RUN_GRADLEW,
        env: {
          EAS_BUILD_MAVEN_CACHE_URL: 'https://szymon.pl/maven/cache',
        },
      },
      '/fake/path'
    );

    expect(err.errorCode).toBe('MAVEN_CACHE_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_UNKNOWN_GRADLE_ERROR');
    expect(err.userFacingMessage).toBe(
      `Gradle build failed with unknown error. See logs for the "Run gradlew" phase for more information.`
    );
  });

  it('does not throw MAVEN_CACHE_ERROR if "Could not find BlurView-version-2.0.3.jar" log is present', async () => {
    const err = await resolveBuildPhaseErrorAsync(
      new Error(),
      [`Could not find BlurView-version-2.0.3.jar sth sthelse https://szymon.pl/maven/cache`],
      {
        job: { platform: Platform.ANDROID, mode: BuildMode.BUILD } as Job,
        phase: BuildPhase.RUN_GRADLEW,
        env: {
          EAS_BUILD_MAVEN_CACHE_URL: 'https://szymon.pl/maven/cache',
        },
      },
      '/fake/path'
    );

    expect(err.errorCode).toBe('EAS_BUILD_UNKNOWN_GRADLE_ERROR');
    expect(err.userFacingErrorCode).toBe('EAS_BUILD_UNKNOWN_GRADLE_ERROR');
    expect(err.userFacingMessage).toBe(
      `Gradle build failed with unknown error. See logs for the "Run gradlew" phase for more information.`
    );
  });
});
