import {
  Android,
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  Ios,
  NativeBuilder,
  Platform,
  Workflow,
} from '@expo/eas-build-job';
import { randomUUID } from 'crypto';

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

export function createTestXcodeJob(overrides: Record<string, unknown> = {}): Ios.Job {
  return {
    mode: BuildMode.BUILD,
    builder: NativeBuilder.XCODE,
    platform: Platform.IOS,
    triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
    type: Workflow.GENERIC,
    projectArchive: {
      type: ArchiveSourceType.GIT,
      gitCommitHash: '0123456789abcdef0123456789abcdef01234567',
      gitRef: 'refs/heads/main',
    },
    projectRootDirectory: '.',
    simulator: false,
    appIdentifier: 'dev.expo.nativeapp',
    distribution: 'store',
    secrets: { robotAccessToken: 'robot-access-token' },
    appId: randomUUID(),
    initiatingUserId: randomUUID(),
    ...overrides,
  } as Ios.Job;
}

export function createTestXcodeSimulatorJob(overrides: Record<string, unknown> = {}): Ios.Job {
  return createTestXcodeJob({
    simulator: true,
    appIdentifier: undefined,
    distribution: undefined,
    ...overrides,
  });
}
