import { DeviceRunSession, SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { z } from 'zod';

import { BuildContext } from '../context';
import { CustomBuildContext } from '../customBuildContext';
import { stopLocalEgressResourcesAsync } from '../steps/utils/localEgress';
import { executeTaskGraphAsync } from './graph';
import { planDeviceRunSession } from './plan';
import { SessionRuntime, type SessionTask } from './runtime';
import { type TaskResult } from './types';

export { planDeviceRunSession } from './plan';
export {
  SessionRuntime,
  type SessionState,
  type SessionTask,
  type SessionTaskContext,
} from './runtime';
export { executeTaskGraphAsync, validateTaskGraph, TaskGraphDefinitionError } from './graph';
export type { TaskDefinition, TaskFailurePolicy, TaskOutcome, TaskResult } from './types';

const TEARDOWN_TASK = { id: 'teardown', displayName: 'Clean up', onFailure: 'warn' } as const;

/**
 * Runs an EAS Simulator device run session from a `DeviceRunSession.Job`.
 *
 * Plans the session as a task graph, runs it with the concurrency the
 * dependencies allow, and tears everything down in reverse order whatever the
 * outcome. Resolves when the session has ended; rejects with the first
 * session-failing error, which the worker reports on the job run.
 */
export async function runDeviceRunSessionJobAsync(
  ctx: BuildContext<DeviceRunSession.Job>,
  { signal = new AbortController().signal }: { signal?: AbortSignal } = {}
): Promise<void> {
  const parsed = DeviceRunSession.JobZ.safeParse(ctx.job);
  if (!parsed.success) {
    throw new SystemError(
      `The device run session job is invalid, so the worker cannot run it. This is a bug in the API server that created the job.\n${z.prettifyError(parsed.error)}`
    );
  }

  const customBuildCtx = new CustomBuildContext(ctx);
  const runtime = new SessionRuntime(customBuildCtx);
  if (customBuildCtx.runtimePlatform !== runtime.runtimePlatform) {
    throw new SystemError(
      `This worker runs ${customBuildCtx.runtimePlatform} but the session requests a ${runtime.device.platform} device. The API server scheduled the job on the wrong resource class.`
    );
  }

  const tasks = planDeviceRunSession(runtime.job);
  runtime.logger.info(
    {
      controller: runtime.session.controller,
      device: runtime.device,
      application: runtime.job.application ?? null,
      egress: runtime.job.egress ?? null,
      tasks: tasks.map(task => ({
        id: task.id,
        needs: task.needs ?? [],
        after: task.after ?? [],
        onFailure: task.onFailure,
      })),
    },
    'Planned the device run session.'
  );

  const taskLoggers = new Map<string, bunyan>();
  const loggerFor = (task: SessionTask): bunyan => {
    let logger = taskLoggers.get(task.id);
    if (!logger) {
      logger = runtime.createTaskLogger(task);
      taskLoggers.set(task.id, logger);
    }
    return logger;
  };

  const results: TaskResult[] = [];
  let fatalError: unknown;
  try {
    const execution = await executeTaskGraphAsync(tasks, {
      signal,
      createContext: (task, taskSignal) => ({
        logger: loggerFor(task),
        signal: taskSignal,
        runtime,
      }),
      onTaskStart: task => runtime.logTaskStart(task, loggerFor(task)),
      onTaskFinish: (task, result) => {
        results.push(result);
        runtime.logTaskFinish(task, result, loggerFor(task));
        runtime.reportTaskMetric(result);
      },
    });
    fatalError = execution.fatalError;
  } finally {
    const teardownLogger = runtime.createTaskLogger(TEARDOWN_TASK);
    const startedAt = Date.now();
    runtime.logTaskStart(TEARDOWN_TASK, teardownLogger);
    await runtime.teardown.runAsync({ logger: teardownLogger });
    // The egress task may have registered resources without finishing.
    await stopLocalEgressResourcesAsync(teardownLogger);
    await customBuildCtx.drainPendingMetricUploads();
    runtime.logTaskFinish(
      TEARDOWN_TASK,
      { id: TEARDOWN_TASK.id, outcome: 'success', durationMs: Date.now() - startedAt },
      teardownLogger
    );
  }

  const degraded = results.filter(result => result.outcome === 'failed' && !isFatal(result));
  if (degraded.length > 0) {
    runtime.logger.warn(
      `The session ran without: ${degraded.map(result => result.id).join(', ')}.`
    );
  }
  if (fatalError !== undefined) {
    throw fatalError instanceof Error ? fatalError : new Error(String(fatalError));
  }

  function isFatal(result: TaskResult): boolean {
    return result.error !== undefined && result.error === fatalError;
  }
}
