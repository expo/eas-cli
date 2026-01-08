import { randomUUID } from 'crypto';

import {
  Android,
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Ios,
  Platform,
  Workflow,
} from '@expo/eas-build-job';

const androidCredentials: Android.BuildSecrets['buildCredentials'] = {
  keystore: {
    dataBase64: 'MjEzNwo=',
    keystorePassword: 'pass1',
    keyAlias: 'alias',
    keyPassword: 'pass2',
  },
};

const iosCredentials: Ios.BuildCredentials = {
  testapp: {
    provisioningProfileBase64: '',
    distributionCertificate: {
      dataBase64: '',
      password: '',
    },
  },
};

export function createTestAndroidJob({
  buildCredentials = androidCredentials,
}: {
  buildCredentials?: Android.BuildSecrets['buildCredentials'];
} = {}): Android.Job {
  return {
    mode: BuildMode.BUILD,
    platform: Platform.ANDROID,
    triggeredBy: BuildTrigger.EAS_CLI,
    type: Workflow.GENERIC,
    projectArchive: {
      type: ArchiveSourceType.URL,
      url: 'https://turtle-v2-test-fixtures.s3.us-east-2.amazonaws.com/project.tar.gz',
    },
    projectRootDirectory: '.',
    applicationArchivePath: './android/app/build/outputs/apk/release/*.apk',
    cache: {
      clear: false,
      disabled: false,
      paths: [],
    },
    secrets: {
      buildCredentials,
    },
    appId: randomUUID(),
    initiatingUserId: randomUUID(),
  };
}

export function createTestIosJob({
  buildCredentials = iosCredentials,
  triggeredBy = BuildTrigger.EAS_CLI,
  workflowInterpolationContext,
}: {
  buildCredentials?: Ios.BuildCredentials;
  triggeredBy?: Ios.Job['triggeredBy'];
  workflowInterpolationContext?: Ios.Job['workflowInterpolationContext'];
} = {}): Ios.Job {
  return {
    mode: BuildMode.BUILD,
    platform: Platform.IOS,
    triggeredBy,
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
      clear: false,
      disabled: false,
      paths: [],
    },
    secrets: {
      buildCredentials,
    },
    appId: randomUUID(),
    initiatingUserId: randomUUID(),
    workflowInterpolationContext,
  };
}
