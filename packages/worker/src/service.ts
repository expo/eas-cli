import assert from 'assert';
import path from 'path';

import {
  Artifacts,
  BuildContext,
  findAndUploadXcodeBuildLogsAsync,
  Hook,
  runHookIfPresent,
} from '@expo/build-tools';
import {
  BuildJob,
  BuildMode,
  BuildPhase,
  BuildPhaseStats,
  errors,
  Ios,
  Job,
  Metadata,
  Platform,
} from '@expo/eas-build-job';
import { LoggerLevel } from '@expo/logger';
import {
  LauncherMessage,
  LoggerStream,
  promise,
  WebSocketServer,
  Worker,
  WorkerMessage,
} from '@expo/turtle-common';
import fs from 'fs-extra';

import { build } from './build';
import config from './config';
import { createBuildContext } from './context';
import { Analytics } from './external/analytics';
import logger, { createBuildLoggerWithSecretsFilter } from './logger';
import sentry from './sentry';
import State from './state';

export const HANGING_WORKER_CHECK_TIMEOUT_MS = 5 * 60 * 1000;

export default class BuildService {
  private readonly _buildId: string;
  private startedProcessingBuild: boolean;
  private readonly state: State = new State();
  private ws: WebSocketServer<LauncherMessage.Message, WorkerMessage.Message> | null = null;
  private shouldCloseWorker = false;
  private loggerStream?: LoggerStream;
  private _startBuildTime?: number;
  private buildContext?: BuildContext<Job>;

  constructor() {
    this._buildId = config.buildId;
    this.startedProcessingBuild = false;
  }

  get startBuildTime(): number {
    if (!this._startBuildTime) {
      throw new Error('Call startBuild first!');
    }
    return this._startBuildTime;
  }

  get buildId(): string {
    return this._buildId;
  }

  get isConnected(): boolean {
    return !!this.ws;
  }

  get shouldClose(): boolean {
    return this.shouldCloseWorker;
  }

  private getHangingWorkerCheckTimeoutMs(): number {
    return HANGING_WORKER_CHECK_TIMEOUT_MS;
  }

  public setWS(ws: WebSocketServer | null): void {
    this.ws = ws;
  }

  public startBuild({
    job,
    projectId: _projectId,
    initiatingUserId: _initiatingUserId,
    metadata,
    ...rest
  }: LauncherMessage.Dispatch): void {
    if (this.startedProcessingBuild) {
      // the job has already been started
      return;
    }

    logger.level(job.loggerLevel ?? LoggerLevel.INFO);

    const projectId = job.appId ?? _projectId;
    const initiatingUserId = job.initiatingUserId ?? _initiatingUserId;

    const taskId = rest.jobType === 'jobRun' ? rest.jobRunId : rest.buildId;
    if (taskId !== this.buildId) {
      sentry.handleError(
        `Launcher handling build with ID ${taskId} attempted to start build on worker assigned for handling build with ID ${this.buildId} (no action needed)`
      );
      return;
    }

    this.startedProcessingBuild = true;
    this.state.buildStarted();
    this._startBuildTime = Date.now();

    void this.startBuildInternal({ job, metadata, initiatingUserId, projectId });
  }

  public async finishError(err: errors.BuildError, artifacts: Artifacts | null): Promise<void> {
    logger.error({ err }, 'Job finished with error');

    this.state.finish(Worker.Status.ERROR, {
      applicationArchiveName: artifacts?.APPLICATION_ARCHIVE ?? null,
      buildArtifactsName: artifacts?.BUILD_ARTIFACTS ?? null,
      userError: err,
    });
    const isSocketClosed: boolean = !this.ws;
    // wait 5 seconds to make sure all logs are flushed
    await promise.sleep(5 * 1000);
    await this.loggerStream?.cleanUp();
    if (this.ws) {
      logger.info('Send build result - error');
      this.ws.send({
        type: WorkerMessage.MessageType.ERROR,
        applicationArchiveName: artifacts?.APPLICATION_ARCHIVE ?? null,
        buildArtifactsName: artifacts?.BUILD_ARTIFACTS ?? null,
        externalBuildError: err.format(),
        internalErrorCode: err.errorCode,
      });
    }
    void this.checkForHangingWorker(isSocketClosed);
  }

  public async finishSuccess(artifacts: Artifacts): Promise<void> {
    logger.info('Job finished successfully');
    this.state.finish(Worker.Status.SUCCESS, {
      applicationArchiveName: artifacts.APPLICATION_ARCHIVE ?? null,
      buildArtifactsName: artifacts.BUILD_ARTIFACTS ?? null,
    });
    const isSocketClosed: boolean = !this.ws;
    await this.loggerStream?.cleanUp();
    if (this.ws) {
      logger.info('Send build result - success');
      this.ws.send({
        type: WorkerMessage.MessageType.SUCCESS,
        applicationArchiveName: artifacts.APPLICATION_ARCHIVE ?? null,
        buildArtifactsName: artifacts.BUILD_ARTIFACTS ?? null,
      });
    }
    void this.checkForHangingWorker(isSocketClosed);
  }

  public async finishAbort({ reason }: LauncherMessage.BuildAbort): Promise<void> {
    const currentState = this.state.stateResponse();
    if ([Worker.Status.SUCCESS, Worker.Status.ERROR].includes(currentState.status)) {
      // Build has finished in the meantime before receiving ABORT message
      return;
    }

    this.state.setAbortReason(reason);
    const wasBuildCanceled = reason === LauncherMessage.AbortReason.CANCEL;
    logger.info('Job aborted - ' + wasBuildCanceled ? 'canceled by user' : 'build timed out');
    await this.maybeUploadXCodeLogs();
    this.state.finish(Worker.Status.ABORTED, {
      applicationArchiveName: null,
      buildArtifactsName: null,
    });

    if (
      wasBuildCanceled &&
      this.buildContext &&
      'mode' in this.buildContext.job &&
      ![BuildMode.CUSTOM, BuildMode.REPACK].includes(this.buildContext.job.mode)
    ) {
      const projectDir = this.buildContext.getReactNativeProjectDirectory();
      const packageJsonPath = path.join(projectDir, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        try {
          await this.buildContext?.runBuildPhase(BuildPhase.ON_BUILD_CANCEL_HOOK, async () => {
            assert(this.buildContext);
            await runHookIfPresent(
              this.buildContext as BuildContext<BuildJob>,
              Hook.ON_BUILD_CANCEL
            );
          });
        } catch (err: any) {
          logger.warn({ err }, 'On cancel hook resulted in an error');
        }
      }
    }

    const isSocketClosed: boolean = !this.ws;
    await this.loggerStream?.cleanUp();
    if (this.ws) {
      logger.info('Send build result - aborted');
      this.ws.send({
        type: WorkerMessage.MessageType.ABORTED,
        reason,
      });
    }
    void this.checkForHangingWorker(isSocketClosed);
  }

  public async checkForHangingWorker(wasSocketClosedAtBuildFinish: boolean): Promise<void> {
    await promise.sleep(this.getHangingWorkerCheckTimeoutMs());
    if (!this.shouldCloseWorker) {
      // after sending BuildSuccess/BuildError message, worker should receive close message, which would set shouldCloseWorker to true
      // if it's still false after 5 minutes it may mean that the communication failed and worker is hanging
      logger.info(
        'Worker still alive 5 minutes after sending BuildSuccess/BuildError message - notifying Sentry'
      );
      await this.reportHangingWorker(wasSocketClosedAtBuildFinish);
    }
  }

  public async reportHangingWorker(wasSocketClosedAtBuildFinish: boolean): Promise<void> {
    sentry.handleError(
      'Worker still alive 5 minutes after sending BuildSuccess/BuildError message - possibly hanging',
      undefined,
      {
        tags: {
          errorCode: 'WORKER_POSSIBLY_HANGING',
        },
        extras: {
          buildId: this.buildId,
          state: this.state.stateResponse().status,
          shouldCloseWorker: String(this.shouldCloseWorker),
          startBuildTime: String(this.startBuildTime),
          isSockedClosed: String(!this.ws),
          wasSocketClosedAtBuildFinish: String(wasSocketClosedAtBuildFinish),
        },
      }
    );
  }

  public reportBuildPhaseStats(stats: BuildPhaseStats): void {
    if (this.ws) {
      logger.info(stats, 'Sending build phase stats');
      this.ws.send({
        type: WorkerMessage.MessageType.BUILD_PHASE_STATS,
        ...stats,
      });
    }
  }

  public syncLauncherState({ buildId }: LauncherMessage.StateQuery): void {
    if (this.buildId !== buildId) {
      // should not happen (malicious or invalid connection)
    } else {
      const response = this.state.stateResponse();
      if (this.ws) {
        this.ws.send(response);
      }
    }
  }

  public closeWorker(): void {
    if (this.ws) {
      this.ws.close();
    }
    this.ws = null;
    this.shouldCloseWorker = true;
  }

  private async startBuildInternal({
    job,
    metadata,
    projectId,
    initiatingUserId,
  }: {
    job: Job;
    metadata: Metadata | undefined;
    projectId: string;
    initiatingUserId: string;
  }): Promise<void> {
    try {
      const {
        logger: buildLogger,
        stream,
        logBuffer,
      } = await createBuildLoggerWithSecretsFilter(job.secrets?.environmentSecrets);
      this.loggerStream = stream;

      const analytics = new Analytics(initiatingUserId, metadata?.trackingContext ?? {});

      const ctx = createBuildContext({
        job,
        logBuffer,
        analytics,
        metadata: metadata ?? {},
        projectId,
        buildId: this.buildId,
        buildLogger,
        reportBuildPhaseStatsFn: (stats) => {
          this.reportBuildPhaseStats(stats);
        },
      });
      this.buildContext = ctx;

      const artifacts = await build({
        ctx,
        buildId: this.buildId,
        analytics,
      });
      await this.finishSuccess(artifacts);
    } catch (error: any) {
      const maybeArtifacts = (error.artifacts as Artifacts | undefined) ?? null;

      const unknownError =
        'mode' in job && [BuildMode.CUSTOM, BuildMode.REPACK].includes(job.mode)
          ? new errors.UnknownCustomBuildError()
          : new errors.UnknownBuildError();
      const err = error instanceof errors.BuildError ? error : unknownError;
      const maybeRawError = error instanceof errors.BuildError ? error.innerError : error;

      sentry.handleError(err.message, maybeRawError, {
        tags: {
          ...(err.buildPhase ? { buildPhase: err.buildPhase } : {}),
          errorCode: err.errorCode,
          ...('type' in job ? { workflow: job.type } : {}),
        },
        extras: {
          buildId: this.buildId,
          ...(maybeRawError.stdout ? { stdout: getLastNLines(100, maybeRawError.stdout) } : {}),
          ...(maybeRawError.stderr ? { stderr: getLastNLines(100, maybeRawError.stderr) } : {}),
        },
      });
      await this.finishError(err, maybeArtifacts);
    }
  }

  private async maybeUploadXCodeLogs(): Promise<void> {
    if (this.buildContext?.job.platform === Platform.IOS) {
      await findAndUploadXcodeBuildLogsAsync(this.buildContext as BuildContext<Ios.Job>, {
        logger: this.buildContext.logger,
      });
    } else {
      logger.debug('Not uploading XCode logs for Android job');
    }
  }
}

function getLastNLines(numberOfLines: number, stream: string): string {
  const lines = stream.split('\n');
  if (lines.length <= numberOfLines) {
    return stream;
  } else {
    return lines.slice(lines.length - numberOfLines, lines.length).join('\n');
  }
}
