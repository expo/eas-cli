import { DeviceRunSession, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildRuntimePlatform,
  BuildStepEnv,
  BuildStepLogMarker,
  BuildStepStatus,
} from '@expo/steps';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { CustomBuildContext } from '../customBuildContext';
import { Datadog } from '../datadog';
import { type AppiumInstallation } from '../steps/functions/startAppiumRemoteSession';
import { type DeviceWebPreviewHandle } from '../steps/utils/remoteDeviceRunSession';
import { TaskDefinition, TaskResult } from './types';

/** Whatever tool exposes the device to clients: agent-device, Argent, or Appium. */
export type ControllerHandle = {
  /** Fields merged into the session's remote config next to the web preview fields. */
  remoteConfig: Record<string, unknown>;
  /** Arrival time of the newest observed controller event, for idle detection. */
  getLastEventObservedAt: () => Date | undefined;
  stopAsync: () => Promise<void>;
};

/**
 * Typed hand-offs between tasks. The plan's `needs` edges guarantee that a task
 * reading a field runs after the task that writes it.
 */
export type SessionState = {
  device?: { displayName: string; udid?: string; serialId?: string };
  turnArgs?: string[];
  download?: { artifactPath: string };
  install?: { applicationIdentifier: string; activityName?: string };
  appiumInstallation?: AppiumInstallation;
  preview?: DeviceWebPreviewHandle;
  controller?: ControllerHandle;
  remoteConfigPublishedAt?: Date;
};

export type SessionTaskContext = {
  /** Child logger whose lines the website groups under this task. */
  logger: bunyan;
  /** Aborted when the session fails or the worker cancels the job. */
  signal: AbortSignal;
  runtime: SessionRuntime;
};

export type SessionTask = TaskDefinition<SessionTaskContext>;

const DEFAULT_TEARDOWN_DEADLINE_MS = 4 * 60 * 1000;

/**
 * Cleanup actions registered by tasks, run in reverse order of registration.
 * Every action runs even when an earlier one fails; failures are logged.
 */
export class TeardownStack {
  private readonly actions: { name: string; run: (logger: bunyan) => Promise<void> }[] = [];

  public push(name: string, run: (logger: bunyan) => Promise<void>): void {
    this.actions.push({ name, run });
  }

  public get size(): number {
    return this.actions.length;
  }

  public async runAsync({
    logger,
    deadlineMs = DEFAULT_TEARDOWN_DEADLINE_MS,
  }: {
    logger: bunyan;
    deadlineMs?: number;
  }): Promise<void> {
    const deadline = Date.now() + deadlineMs;
    while (this.actions.length > 0) {
      const { name, run } = this.actions.pop()!;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        logger.warn(`Skipping cleanup of ${name}: the cleanup deadline has passed.`);
        continue;
      }
      const timeoutController = new AbortController();
      try {
        await Promise.race([
          run(logger),
          setTimeoutAsync(remainingMs, undefined, { signal: timeoutController.signal }).then(() => {
            throw new Error(
              `Cleanup of ${name} did not finish within ${Math.round(remainingMs / 1000)}s.`
            );
          }),
        ]);
      } catch (err) {
        logger.warn({ err }, `Could not clean up ${name}.`);
      } finally {
        timeoutController.abort();
      }
    }
  }
}

/** Shared state for one device run session: the job, the context, hand-offs, and cleanup. */
export class SessionRuntime {
  public readonly job: DeviceRunSession.Job;
  public readonly session: DeviceRunSession.Session;
  public readonly device: DeviceRunSession.Device;
  public readonly runtimePlatform: BuildRuntimePlatform;
  public readonly startedAt = Date.now();
  public readonly state: SessionState = {};
  public readonly teardown = new TeardownStack();

  constructor(public readonly ctx: CustomBuildContext<DeviceRunSession.Job>) {
    this.job = ctx.job;
    this.session = ctx.job.session;
    this.device = ctx.job.device;
    this.runtimePlatform =
      ctx.job.device.platform === Platform.IOS
        ? BuildRuntimePlatform.DARWIN
        : BuildRuntimePlatform.LINUX;
  }

  public get env(): BuildStepEnv {
    return this.ctx.env;
  }

  /** Session-level logger. Lines logged here are not grouped under a task. */
  public get logger(): bunyan {
    return this.ctx.logger;
  }

  public get deviceRunSessionId(): string {
    return this.session.id;
  }

  public createTaskLogger(task: Pick<SessionTask, 'id' | 'displayName'>): bunyan {
    return this.ctx.logger.child({
      buildStepId: task.id,
      buildStepDisplayName: task.displayName,
    });
  }

  public logTaskStart(task: Pick<SessionTask, 'displayName'>, logger: bunyan): void {
    logger.info({ marker: BuildStepLogMarker.START_STEP }, `Starting "${task.displayName}".`);
  }

  public logTaskFinish(
    task: Pick<SessionTask, 'displayName' | 'onFailure'>,
    result: TaskResult,
    logger: bunyan
  ): void {
    const duration = formatDuration(result.durationMs);
    switch (result.outcome) {
      case 'success':
        logger.info(
          { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.SUCCESS },
          `Finished "${task.displayName}" in ${duration}.`
        );
        break;
      case 'failed':
        if (task.onFailure === 'fail-session') {
          logger.error({ err: result.error });
          logger.error(
            { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.FAIL },
            `"${task.displayName}" failed after ${duration}. The session cannot continue.`
          );
        } else {
          logger.warn({ err: result.error });
          logger.warn(
            { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.WARNING },
            task.onFailure === 'degrade-application'
              ? `"${task.displayName}" failed after ${duration}. The device stays usable, but the application will not be available in this session.`
              : `"${task.displayName}" failed after ${duration}. The session continues without it.`
          );
        }
        break;
      case 'skipped':
        logger.info({ marker: BuildStepLogMarker.START_STEP }, `Starting "${task.displayName}".`);
        logger.info(
          { marker: BuildStepLogMarker.END_STEP, result: BuildStepStatus.SKIPPED },
          `Skipped "${task.displayName}": ${result.skipReason ?? 'not needed'}.`
        );
        break;
    }
  }

  public reportTaskMetric(result: TaskResult): void {
    if (result.outcome === 'skipped') {
      return;
    }
    Datadog.distribution('device_run_session.task_duration_ms', result.durationMs, {
      task: result.id,
      result: result.outcome,
      ...this.metricTags(),
    });
  }

  public metricTags(): Record<string, string> {
    return {
      controller: this.session.controller,
      device_platform: this.device.platform,
    };
  }
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}
