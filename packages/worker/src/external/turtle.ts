import { GCS } from '@expo/build-tools';
import { BuildJob, Generic, Metadata, errors } from '@expo/eas-build-job';

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

    runMetricsServer: boolean;

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

    runMetricsServer: boolean;

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
    ABORTED = 'aborted',
  }

  export enum AbortReason {
    CANCEL = 'cancel',
    TIMEOUT = 'timeout',
  }

  export type Message = StateResponse | BuildSuccess | BuildError | BuildAborted;
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
