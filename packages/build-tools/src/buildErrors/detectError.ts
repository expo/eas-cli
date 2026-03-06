import { BuildPhase, errors } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { buildErrorHandlers } from './buildErrorHandlers';
import { ErrorContext, ErrorHandler, XCODE_BUILD_PHASE } from './errors.types';
import { userErrorHandlers } from './userErrorHandlers';
import { findXcodeBuildLogsPathAsync } from '../ios/xcodeBuildLogs';

async function maybeReadXcodeBuildLogs(
  phase: BuildPhase,
  buildLogsDirectory: string
): Promise<string | undefined> {
  if (phase !== BuildPhase.RUN_FASTLANE) {
    return;
  }

  try {
    const xcodeBuildLogsPath = await findXcodeBuildLogsPathAsync(buildLogsDirectory);

    if (!xcodeBuildLogsPath) {
      return;
    }

    return await fs.readFile(xcodeBuildLogsPath, 'utf-8');
  } catch {
    return undefined;
  }
}

function resolveError<TError extends Error>(
  errorHandlers: ErrorHandler<TError>[],
  logLines: string[],
  errorContext: ErrorContext,
  xcodeBuildLogs?: string
): TError | undefined {
  const { job, phase } = errorContext;
  const { platform } = job;
  const logs = logLines.join('\n');
  const handlers = errorHandlers
    .filter(handler => handler.platform === platform || !handler.platform)
    .filter(
      handler =>
        (handler.phase === XCODE_BUILD_PHASE && phase === BuildPhase.RUN_FASTLANE) ||
        handler.phase === phase ||
        !handler.phase
    )
    .filter(handler => ('mode' in job && handler.mode === job.mode) || !handler.mode);

  for (const handler of handlers) {
    const regexp =
      typeof handler.regexp === 'function' ? handler.regexp(errorContext) : handler.regexp;
    if (!regexp) {
      continue;
    }
    const match =
      handler.phase === XCODE_BUILD_PHASE ? xcodeBuildLogs?.match(regexp) : logs.match(regexp);

    if (match) {
      return handler.createError(match, errorContext);
    }
  }
  return undefined;
}

export async function resolveBuildPhaseErrorAsync(
  error: any,
  logLines: string[],
  errorContext: ErrorContext,
  buildLogsDirectory: string
): Promise<errors.BuildError> {
  const { phase } = errorContext;
  if (error instanceof errors.BuildError) {
    return error;
  }
  const xcodeBuildLogs = await maybeReadXcodeBuildLogs(phase, buildLogsDirectory);
  const userFacingError =
    error instanceof errors.UserFacingError
      ? error
      : (resolveError(userErrorHandlers, logLines, errorContext, xcodeBuildLogs) ??
        new errors.UnknownError(errorContext.phase));
  const buildError = resolveError(buildErrorHandlers, logLines, errorContext, xcodeBuildLogs);

  const trackingCode =
    buildError && buildError.errorCode !== userFacingError.errorCode
      ? buildError.errorCode
      : undefined;

  return new errors.BuildError(userFacingError.message, {
    errorCode: userFacingError.errorCode,
    trackingCode,
    docsUrl: userFacingError.docsUrl,
    cause: error,
    buildPhase: phase,
    metadata: buildError?.metadata,
  });
}
