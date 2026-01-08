import { vol } from 'memfs';

import { injectCredentialsGradleConfig, injectConfigureVersionGradleConfig } from '../gradleConfig';
import { EasBuildInjectAndroidCredentialsGradle } from '../../../../templates/EasBuildInjectAndroidCredentialsGradle';

// Sample build.gradle content
const SAMPLE_BUILD_GRADLE = `apply plugin: "com.android.application"

android {
    compileSdkVersion 33

    defaultConfig {
        applicationId "com.example.app"
        minSdkVersion 21
        targetSdkVersion 33
        versionCode 1
        versionName "1.0"
    }
}
`;

describe('gradleConfig', () => {
  let mockLogger: any;

  beforeEach(() => {
    vol.reset();
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Set up Android project structure in the mock filesystem
    vol.fromJSON({
      '/workingdir/android/app/build.gradle': SAMPLE_BUILD_GRADLE,
    });
  });

  afterEach(() => {
    vol.reset();
  });

  describe('injectCredentialsGradleConfig', () => {
    it('should copy credentials gradle file to android/app directory', async () => {
      await injectCredentialsGradleConfig(mockLogger, '/workingdir');

      const credentialsGradlePath =
        '/workingdir/android/app/eas-build-inject-android-credentials.gradle';
      const generatedContent = vol.readFileSync(credentialsGradlePath, 'utf-8') as string;

      // Verify the file was copied
      expect(generatedContent).toBe(EasBuildInjectAndroidCredentialsGradle);
      expect(generatedContent).toContain('// Build integration with EAS');
      expect(generatedContent).toContain('signingConfigs');
      expect(generatedContent).toContain('credentials.json');
      expect(generatedContent).toContain('android.keystore');
    });

    it('should add apply statement to build.gradle', async () => {
      await injectCredentialsGradleConfig(mockLogger, '/workingdir');

      const buildGradlePath = '/workingdir/android/app/build.gradle';
      const buildGradleContent = vol.readFileSync(buildGradlePath, 'utf-8') as string;

      expect(buildGradleContent).toContain(
        'apply from: "./eas-build-inject-android-credentials.gradle"'
      );
    });

    it('should not duplicate apply statement if already present', async () => {
      // Add the apply statement first
      await injectCredentialsGradleConfig(mockLogger, '/workingdir');

      const buildGradlePath = '/workingdir/android/app/build.gradle';
      const contentAfterFirst = vol.readFileSync(buildGradlePath, 'utf-8') as string;
      const firstOccurrences = (
        contentAfterFirst.match(
          /apply from: "\.\/eas-build-inject-android-credentials\.gradle"/g
        ) ?? []
      ).length;

      // Call again
      await injectCredentialsGradleConfig(mockLogger, '/workingdir');

      const contentAfterSecond = vol.readFileSync(buildGradlePath, 'utf-8') as string;
      const secondOccurrences = (
        contentAfterSecond.match(
          /apply from: "\.\/eas-build-inject-android-credentials\.gradle"/g
        ) ?? []
      ).length;

      expect(firstOccurrences).toBe(1);
      expect(secondOccurrences).toBe(1);
    });

    it('should replace existing credentials gradle file', async () => {
      // Create an old credentials file
      const credentialsGradlePath =
        '/workingdir/android/app/eas-build-inject-android-credentials.gradle';
      vol.writeFileSync(credentialsGradlePath, '// Old content');

      await injectCredentialsGradleConfig(mockLogger, '/workingdir');

      const generatedContent = vol.readFileSync(credentialsGradlePath, 'utf-8') as string;
      expect(generatedContent).not.toContain('// Old content');
      expect(generatedContent).toBe(EasBuildInjectAndroidCredentialsGradle);
    });

    it('should log info messages', async () => {
      await injectCredentialsGradleConfig(mockLogger, '/workingdir');

      expect(mockLogger.info).toHaveBeenCalledWith('Injecting signing config into build.gradle');
      expect(mockLogger.info).toHaveBeenCalledWith('Signing config injected');
    });
  });

  describe('injectConfigureVersionGradleConfig', () => {
    it('should create version gradle file with all variables substituted', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '42',
        versionName: '2.3.4',
      });

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle only versionCode provided', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '123',
      });

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle only versionName provided', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionName: '1.2.3-beta',
      });

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle neither versionCode nor versionName provided', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {});

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should add apply statement to build.gradle', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '1',
        versionName: '1.0.0',
      });

      const buildGradlePath = '/workingdir/android/app/build.gradle';
      const buildGradleContent = vol.readFileSync(buildGradlePath, 'utf-8') as string;

      expect(buildGradleContent).toContain('apply from: "./eas-build-configure-version.gradle"');
    });

    it('should not duplicate apply statement if already present', async () => {
      // Add the apply statement first
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '1',
      });

      const buildGradlePath = '/workingdir/android/app/build.gradle';
      const contentAfterFirst = vol.readFileSync(buildGradlePath, 'utf-8') as string;
      const firstOccurrences = (
        contentAfterFirst.match(/apply from: "\.\/eas-build-configure-version\.gradle"/g) ?? []
      ).length;

      // Call again
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionName: '2.0.0',
      });

      const contentAfterSecond = vol.readFileSync(buildGradlePath, 'utf-8') as string;
      const secondOccurrences = (
        contentAfterSecond.match(/apply from: "\.\/eas-build-configure-version\.gradle"/g) ?? []
      ).length;

      expect(firstOccurrences).toBe(1);
      expect(secondOccurrences).toBe(1);
    });

    it('should replace existing version gradle file', async () => {
      // Create an old version file
      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      vol.writeFileSync(versionGradlePath, '// Old version content');

      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '999',
        versionName: '9.9.9',
      });

      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should log info messages with version details', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '42',
        versionName: '2.3.4',
      });

      expect(mockLogger.info).toHaveBeenCalledWith('Injecting version config into build.gradle');
      expect(mockLogger.info).toHaveBeenCalledWith('Version code: 42');
      expect(mockLogger.info).toHaveBeenCalledWith('Version name: 2.3.4');
      expect(mockLogger.info).toHaveBeenCalledWith('Version config injected');
    });

    it('should handle version code as string with leading zeros', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '0042',
        versionName: '1.0.0',
      });

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should handle version name with special characters', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '1',
        versionName: '1.0.0-rc.1+build.123',
      });

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });

    it('should produce valid Gradle syntax', async () => {
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '100',
        versionName: '3.0.0',
      });

      const versionGradlePath = '/workingdir/android/app/eas-build-configure-version.gradle';
      const generatedContent = vol.readFileSync(versionGradlePath, 'utf-8') as string;
      expect(generatedContent).toMatchSnapshot();
    });
  });

  describe('combined usage', () => {
    it('should handle both credentials and version injection together', async () => {
      await injectCredentialsGradleConfig(mockLogger, '/workingdir');
      await injectConfigureVersionGradleConfig(mockLogger, '/workingdir', {
        versionCode: '50',
        versionName: '5.0.0',
      });

      const buildGradlePath = '/workingdir/android/app/build.gradle';
      const buildGradleContent = vol.readFileSync(buildGradlePath, 'utf-8') as string;

      // Both apply statements should be present
      expect(buildGradleContent).toContain(
        'apply from: "./eas-build-inject-android-credentials.gradle"'
      );
      expect(buildGradleContent).toContain('apply from: "./eas-build-configure-version.gradle"');

      // Both files should exist
      const credentialsPath = '/workingdir/android/app/eas-build-inject-android-credentials.gradle';
      const versionPath = '/workingdir/android/app/eas-build-configure-version.gradle';

      expect(vol.existsSync(credentialsPath)).toBe(true);
      expect(vol.existsSync(versionPath)).toBe(true);
    });
  });
});
