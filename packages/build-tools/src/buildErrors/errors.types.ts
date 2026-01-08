import { BuildMode, BuildPhase, Env, Job, Platform } from '@expo/eas-build-job';

export interface ErrorContext<TJob extends Job = Job> {
  phase: BuildPhase;
  job: TJob;
  env: Env;
}

export const XCODE_BUILD_PHASE = 'XCODE_BUILD';

export interface ErrorHandler<T extends Error> {
  regexp: RegExp | ((ctx: ErrorContext) => RegExp | undefined);
  platform?: Platform;
  phase?: BuildPhase | typeof XCODE_BUILD_PHASE;
  mode?: BuildMode;
  createError: (matchResult: RegExpMatchArray, errCtx: ErrorContext) => T | undefined;
}
