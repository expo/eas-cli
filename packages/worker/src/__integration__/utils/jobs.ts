import {
  Android,
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Ios,
  Platform,
  Workflow,
} from '@expo/eas-build-job';
import { randomUUID } from 'crypto';

const androidCredentials: Android.Keystore = {
  dataBase64: 'MjEzNwo=',
  keystorePassword: 'pass1',
  keyAlias: 'alias',
  keyPassword: 'pass2',
};

export function createTestAndroidJob({
  projectArchive,
}: { projectArchive?: Android.Job['projectArchive'] } = {}): Android.Job {
  return {
    mode: BuildMode.BUILD,
    platform: Platform.ANDROID,
    triggeredBy: BuildTrigger.EAS_CLI,
    type: Workflow.GENERIC,
    projectArchive: projectArchive ?? {
      type: ArchiveSourceType.URL,
      url: 'https://turtle-v2-test-fixtures.s3.us-east-2.amazonaws.com/project.tar.gz',
    },
    gradleCommand: ':app:bundleRelease',
    applicationArchivePath: 'android/app/build/outputs/bundle/release/app.aab',
    projectRootDirectory: '.',
    cache: {
      disabled: false,
      clear: false,
      paths: [],
    },
    secrets: {
      buildCredentials: {
        keystore: androidCredentials,
      },
    },
    initiatingUserId: randomUUID(),
    appId: randomUUID(),
  };
}

const iosCredentials: Ios.BuildCredentials = {
  testapp: {
    provisioningProfileBase64: 'MjEzNwo=',
    distributionCertificate: {
      dataBase64: 'MjEzNwo=',
      password: 'dominiksokal',
    },
  },
};

export function createTestIosJob({
  buildCredentials = iosCredentials,
}: {
  buildCredentials?: Ios.BuildCredentials;
} = {}): Ios.Job {
  return {
    mode: BuildMode.BUILD,
    platform: Platform.IOS,
    triggeredBy: BuildTrigger.EAS_CLI,
    type: Workflow.GENERIC,
    projectArchive: {
      type: ArchiveSourceType.URL,
      url: 'https://turtle-v2-test-fixtures.s3.us-east-2.amazonaws.com/project.tar.gz',
    },
    scheme: 'turtlebareproj',
    buildConfiguration: 'Release',
    applicationArchivePath: './ios/build/*.ipa',
    projectRootDirectory: '.',
    cache: {
      disabled: false,
      clear: false,
      paths: [],
    },
    secrets: {
      buildCredentials,
    },
    initiatingUserId: randomUUID(),
    appId: randomUUID(),
  };
}
