import { GCS } from '@expo/build-tools';
import {
  BuildJob,
  BuildPhase,
  BuildPhaseResult,
  errors,
  Generic,
  Metadata,
  Platform,
} from '@expo/eas-build-job';

export enum ResourceClass {
  ANDROID_N2_1_3_12 = 'android-n2-1.3-12',
  ANDROID_N2_2_6_24 = 'android-n2-2.6-24',
  IOS_M1_4_16 = 'ios-m1-4-16',
  IOS_M2_2_8 = 'ios-m2-2-8',
  IOS_M2_PRO_4_12 = 'ios-m2-pro-4-12',
  IOS_M2_4_22 = 'ios-m2-4-22',
  IOS_M4_PRO_5_20 = 'ios-m4-pro-5-20',
  IOS_M4_PRO_10_40 = 'ios-m4-pro-10-40',
  LINUX_C3D_STANDARD_4 = 'linux-c3d-standard-4',
  LINUX_C3D_STANDARD_8 = 'linux-c3d-standard-8',
  LINUX_C4D_STANDARD_4 = 'linux-c4d-standard-4',
  LINUX_C4D_STANDARD_8 = 'linux-c4d-standard-8',
}

export const ResourceClassToPlatform: Record<ResourceClass, Platform> = {
  'android-n2-1.3-12': Platform.ANDROID,
  'android-n2-2.6-24': Platform.ANDROID,
  'ios-m1-4-16': Platform.IOS,
  'ios-m2-2-8': Platform.IOS,
  'ios-m2-4-22': Platform.IOS,
  'ios-m2-pro-4-12': Platform.IOS,
  'ios-m4-pro-5-20': Platform.IOS,
  'ios-m4-pro-10-40': Platform.IOS,
  [ResourceClass.LINUX_C3D_STANDARD_4]: Platform.ANDROID,
  [ResourceClass.LINUX_C3D_STANDARD_8]: Platform.ANDROID,
  [ResourceClass.LINUX_C4D_STANDARD_4]: Platform.ANDROID,
  [ResourceClass.LINUX_C4D_STANDARD_8]: Platform.ANDROID,
};

export const androidImagesWithJavaVersionLowerThen11 = [
  'ubuntu-20.04-jdk-8-ndk-r19c',
  'ubuntu-20.04-jdk-11-ndk-r19c',
  'ubuntu-20.04-jdk-8-ndk-r21e',
  'ubuntu-20.04-jdk-11-ndk-r21e',
  'ubuntu-20.04-jdk-11-ndk-r23b',
  'ubuntu-22.04-jdk-8-ndk-r21e',
  'ubuntu-22.04-jdk-11-ndk-r21e',
  'ubuntu-22.04-jdk-11-ndk-r23b',
];

export namespace Worker {
  export enum Status {
    NEW = 'new',
    IN_PROGRESS = 'in-progress',
    SUCCESS = 'success',
    ERROR = 'error',
    ABORTED = 'aborted',
  }

  type JobRunWorkerRuntimeConfig = {
    gcsSignedUploadUrlForLogs: GCS.SignedUrl;

    nodeJsCacheUrl: string | undefined;
    npmCacheUrl: string | undefined;
    mavenCacheUrl: string | undefined;
    cocoapodsCacheUrl: string | undefined;
    runMetricsServer: boolean;
    resourceClass: ResourceClass;

    type: 'jobRun';
    buildId: string;
  };

  type BuildWorkerRuntimeConfig = {
    gcsSignedUploadUrlForApplicationArchive: GCS.SignedUrl | null;
    gcsSignedUploadUrlForBuildArtifacts: GCS.SignedUrl | null;
    gcsSignedUploadUrlForLogs: GCS.SignedUrl;
    gcsSignedUploadUrlForXcodeBuildLogs?: GCS.SignedUrl;
    gcsSignedUploadUrlForBuildCache?: GCS.SignedUrl;
    gcsSignedBuildCacheDownloadUrl?: string;

    nodeJsCacheUrl: string | undefined;
    npmCacheUrl: string | undefined;
    mavenCacheUrl: string | undefined;
    cocoapodsCacheUrl: string | undefined;
    runMetricsServer: boolean;
    resourceClass: ResourceClass;

    type?: never;
    buildId: string;
  };

  export type RuntimeConfig = BuildWorkerRuntimeConfig | JobRunWorkerRuntimeConfig;
}

export namespace WorkerMessage {
  export enum MessageType {
    STATE_RESPONSE = 'state-response',
    SUCCESS = 'success',
    ERROR = 'error',
    BUILD_PHASE_STATS = 'build-phase-stats',
    ABORTED = 'aborted',
  }

  export enum AbortReason {
    CANCEL = 'cancel',
    TIMEOUT = 'timeout',
  }

  export type Message = StateResponse | BuildSuccess | BuildError | BuildPhaseStats | BuildAborted;
  export interface StateResponse {
    type: MessageType.STATE_RESPONSE;
    status: Worker.Status;
    applicationArchiveName: string | null;
    buildArtifactsName: string | null;
    externalBuildError?: errors.ExternalBuildError;
    internalErrorCode?: string;
    abortReason?: AbortReason;
  }
  export interface BuildSuccess {
    type: MessageType.SUCCESS;
    applicationArchiveName: string | null;
    buildArtifactsName: string | null;
  }
  export interface BuildError {
    type: MessageType.ERROR;
    externalBuildError?: errors.ExternalBuildError;
    internalErrorCode?: string;
    applicationArchiveName: string | null;
    buildArtifactsName: string | null;
  }
  export interface BuildPhaseStats {
    type: MessageType.BUILD_PHASE_STATS;
    buildPhase: BuildPhase;
    result: BuildPhaseResult;
    durationMs: number;
  }
  export interface BuildAborted {
    type: MessageType.ABORTED;
    reason?: AbortReason;
  }
}

export namespace LauncherMessage {
  export enum MessageType {
    DISPATCH = 'dispatch',
    STATE_QUERY = 'state-query',
    CLOSE = 'close',
    ABORT = 'abort',
  }

  export enum AbortReason {
    CANCEL = 'cancel',
    TIMEOUT = 'timeout',
  }

  export type Message = Dispatch | StateQuery | Close | BuildAbort;
  export type Dispatch = {
    initiatingUserId: string;
    projectId: string;
    metadata: Metadata;
    type: MessageType.DISPATCH;
  } & (
    | {
        jobType?: never;
        job: BuildJob;
        buildId: string;
      }
    | {
        jobType: 'jobRun';
        job: Generic.Job;
        jobRunId: string;
      }
  );

  export interface StateQuery {
    type: MessageType.STATE_QUERY;
    buildId: string;
  }
  export interface Close {
    type: MessageType.CLOSE;
  }
  export interface BuildAbort {
    type: MessageType.ABORT;
    reason: AbortReason;
  }
}
