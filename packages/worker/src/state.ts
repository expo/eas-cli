import { errors } from '@expo/eas-build-job';
import { WorkerMessage, Worker, LauncherMessage } from '@expo/turtle-common';

type FinalStatus = Worker.Status.SUCCESS | Worker.Status.ERROR | Worker.Status.ABORTED;

class State {
  private status: Worker.Status = Worker.Status.NEW;
  private applicationArchiveName: string | null = null;
  private buildArtifactsName: string | null = null;
  private userError?: errors.BuildError;
  private abortReason?: LauncherMessage.AbortReason;
  private readonly shouldCloseWorker = false;

  get shouldClose(): boolean {
    return this.shouldCloseWorker;
  }

  public buildStarted(): void {
    this.status = Worker.Status.IN_PROGRESS;
  }

  public finish(
    result: FinalStatus,
    {
      applicationArchiveName,
      buildArtifactsName,
      userError,
    }: {
      applicationArchiveName: string | null;
      buildArtifactsName: string | null;
      userError?: errors.BuildError;
    }
  ): void {
    this.status = result;
    this.applicationArchiveName = applicationArchiveName;
    this.buildArtifactsName = buildArtifactsName;
    this.userError = userError;
  }

  public setAbortReason(reason: LauncherMessage.AbortReason): void {
    this.abortReason = reason;
  }

  public stateResponse(): WorkerMessage.StateResponse {
    return {
      type: WorkerMessage.MessageType.STATE_RESPONSE,
      status: this.status,
      buildArtifactsName: this.buildArtifactsName ?? null,
      applicationArchiveName: this.applicationArchiveName ?? null,
      ...(this.userError && {
        externalBuildError: this.userError.format(),
        internalErrorCode: this.userError.errorCode,
      }),
      abortReason: this.abortReason,
    };
  }
}

export default State;
