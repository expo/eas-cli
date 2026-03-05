import { BuildMode } from './common';
import { BuildPhase, buildPhaseDisplayName } from './logs';

export enum ErrorCode {
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  UNKNOWN_CUSTOM_BUILD_ERROR = 'UNKNOWN_CUSTOM_BUILD_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_FASTLANE_ERROR = 'EAS_BUILD_UNKNOWN_FASTLANE_ERROR',
  UNKNOWN_FASTLANE_RESIGN_ERROR = 'EAS_BUILD_UNKNOWN_FASTLANE_RESIGN_ERROR',
  UNKNOWN_GRADLE_ERROR = 'EAS_BUILD_UNKNOWN_GRADLE_ERROR',
  BUILD_TIMEOUT_ERROR = 'EAS_BUILD_TIMEOUT_ERROR',
}

export enum ExpoErrorType {
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export interface ExternalBuildError {
  errorCode: string;
  message: string;
  docsUrl?: string;
  buildPhase?: BuildPhase;
}

interface ExpoErrorDetails {
  type: ExpoErrorType;
  errorCode: string;
  userFacingMessage: string;
  userFacingErrorCode: string;
  docsUrl?: string;
  innerError?: Error;
  buildPhase?: BuildPhase;
  metadata?: Record<string, unknown>;
  cause?: unknown;
}

interface BuildErrorDetails {
  type?: ExpoErrorType;
  errorCode: string;
  userFacingMessage: string;
  userFacingErrorCode: string;
  docsUrl?: string;
  innerError?: Error;
  buildPhase?: BuildPhase;
  metadata?: Record<string, unknown>;
  cause?: unknown;
}

export class ExpoError extends Error {
  public type: ExpoErrorType;
  public errorCode: string;
  public userFacingMessage: string;
  public userFacingErrorCode: string;
  public docsUrl?: string;
  public innerError?: Error;
  public buildPhase?: BuildPhase;
  public metadata: Record<string, unknown>;

  constructor(message: string, details: ExpoErrorDetails) {
    super(message, { cause: details.cause });
    this.type = details.type;
    this.errorCode = details.errorCode;
    this.userFacingErrorCode = details.userFacingErrorCode;
    this.userFacingMessage = details.userFacingMessage;
    this.docsUrl = details.docsUrl;
    this.innerError = details.innerError;
    this.buildPhase = details.buildPhase;
    this.metadata = details.metadata ?? {};
  }

  public format(): ExternalBuildError {
    return {
      errorCode: this.userFacingErrorCode,
      message: this.userFacingMessage,
      docsUrl: this.docsUrl,
      buildPhase: this.buildPhase,
    };
  }
}

export class BuildError extends ExpoError {
  constructor(message: string, details: BuildErrorDetails) {
    super(message, {
      ...details,
      type: details.type ?? ExpoErrorType.SYSTEM,
    });
  }
}

interface UserErrorOptions {
  docsUrl?: string;
  cause?: unknown;
  buildPhase?: BuildPhase;
  metadata?: Record<string, unknown>;
}

export class UserError extends ExpoError {
  constructor(errorCode: string, message: string, options?: UserErrorOptions) {
    super(message, {
      type: ExpoErrorType.USER,
      errorCode,
      userFacingErrorCode: errorCode,
      userFacingMessage: message,
      docsUrl: options?.docsUrl,
      innerError: options?.cause instanceof Error ? options.cause : undefined,
      buildPhase: options?.buildPhase,
      metadata: options?.metadata,
      cause: options?.cause,
    });
  }
}

interface SystemErrorOptions {
  userFacingErrorCode?: string;
  userFacingMessage?: string;
  docsUrl?: string;
  innerError?: Error;
  buildPhase?: BuildPhase;
  metadata?: Record<string, unknown>;
  cause?: unknown;
}

export class SystemError extends ExpoError {
  constructor(errorCode: string, message: string, options?: SystemErrorOptions) {
    super(message, {
      type: ExpoErrorType.SYSTEM,
      errorCode,
      userFacingErrorCode: options?.userFacingErrorCode ?? errorCode,
      userFacingMessage: options?.userFacingMessage ?? message,
      docsUrl: options?.docsUrl,
      innerError: options?.innerError,
      buildPhase: options?.buildPhase,
      metadata: options?.metadata,
      cause: options?.cause,
    });
  }
}

export class UserFacingError extends UserError {}

export class UnknownError extends UserFacingError {
  constructor(buildPhase?: BuildPhase) {
    super(
      ErrorCode.UNKNOWN_ERROR,
      buildPhase
        ? `Unknown error. See logs of the ${buildPhaseDisplayName[buildPhase]} build phase for more information.`
        : 'Unknown error. See logs for more information.'
    );
  }
}

export class UnknownBuildError extends BuildError {
  constructor() {
    const errorCode = ErrorCode.UNKNOWN_ERROR;
    const message = 'Unknown error. See logs for more information.';
    super(message, {
      errorCode,
      userFacingMessage: message,
      userFacingErrorCode: errorCode,
    });
  }
}

export class UnknownCustomBuildError extends BuildError {
  constructor() {
    const errorCode = ErrorCode.UNKNOWN_CUSTOM_BUILD_ERROR;
    const message = 'Unknown custom build error. See logs for more information.';
    super(message, {
      errorCode,
      userFacingMessage: message,
      userFacingErrorCode: errorCode,
    });
  }
}

export class CredentialsDistCertMismatchError extends UserFacingError {
  constructor(message: string) {
    super('EAS_BUILD_CREDENTIALS_DIST_CERT_MISMATCH', message);
  }
}

export function toBuildError(
  error: unknown,
  options?: {
    mode?: BuildMode;
    buildPhase?: BuildPhase;
  }
): BuildError {
  if (error instanceof BuildError) {
    return error;
  }

  if (error instanceof ExpoError) {
    return new BuildError(error.message, {
      type: error.type,
      errorCode: error.errorCode,
      userFacingErrorCode: error.userFacingErrorCode,
      userFacingMessage: error.userFacingMessage,
      docsUrl: error.docsUrl,
      innerError: error.innerError,
      buildPhase: error.buildPhase ?? options?.buildPhase,
      metadata: error.metadata,
      cause: error.cause,
    });
  }

  const isCustomMode =
    options?.mode === BuildMode.CUSTOM || options?.mode === BuildMode.REPACK;
  const fallback = isCustomMode ? new UnknownCustomBuildError() : new UnknownBuildError();
  fallback.buildPhase = options?.buildPhase;
  if (error && typeof error === 'object') {
    fallback.innerError = error as Error;
  }
  return fallback;
}
