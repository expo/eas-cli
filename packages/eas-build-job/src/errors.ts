import { BuildPhase, buildPhaseDisplayName } from './logs';

export enum ErrorCode {
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  UNKNOWN_CUSTOM_BUILD_ERROR = 'UNKNOWN_CUSTOM_BUILD_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  UNKNOWN_FASTLANE_ERROR = 'EAS_BUILD_UNKNOWN_FASTLANE_ERROR',
  UNKNOWN_FASTLANE_RESIGN_ERROR = 'EAS_BUILD_UNKNOWN_FASTLANE_RESIGN_ERROR',
  UNKNOWN_GRADLE_ERROR = 'EAS_BUILD_UNKNOWN_GRADLE_ERROR',
  BUILD_TIMEOUT_ERROR = 'EAS_BUILD_TIMEOUT_ERROR',
}

export interface ExternalBuildError {
  errorCode: string;
  message: string;
  docsUrl?: string;
  buildPhase?: BuildPhase;
}

export type ErrorMetadata = Record<string, unknown>;

interface ExpoErrorDetails<TMetadata extends ErrorMetadata = ErrorMetadata> {
  errorCode: string;
  trackingCode?: string;
  docsUrl?: string;
  buildPhase?: BuildPhase;
  /**
   * Metadata object for the error. Used internally for Sentry/logging/debugging.
   * It is not included in the external build error payload.
   */
  metadata?: TMetadata;
  /**
   * Underlying error that caused this error to be created. Used internally to
   * propagate blame stack traces to the response.
   */
  cause?: Error;
}

interface BuildErrorDetails<
  TMetadata extends ErrorMetadata = ErrorMetadata,
> extends ExpoErrorDetails<TMetadata> {
  innerError?: Error;
}

export class ExpoError<TMetadata extends ErrorMetadata = ErrorMetadata> extends Error {
  public errorCode: string;
  // Internal-only classification used for Sentry, analytics, and worker internalErrorCode.
  // The public error saved on builds and job runs is always `errorCode`.
  public trackingCode?: string;
  public docsUrl?: string;
  public readonly metadata?: TMetadata;
  public override readonly cause?: Error;
  public buildPhase?: BuildPhase;

  constructor(message: string, details: ExpoErrorDetails<TMetadata>) {
    super(message, { cause: details.cause });
    this.errorCode = details.errorCode;
    this.trackingCode = details.trackingCode;
    this.docsUrl = details.docsUrl;
    this.metadata = details.metadata;
    this.cause = details.cause;
    this.buildPhase = details.buildPhase;
  }

  public format(): ExternalBuildError {
    return {
      errorCode: this.errorCode,
      message: this.message,
      docsUrl: this.docsUrl,
      buildPhase: this.buildPhase,
    };
  }
}

export class BuildError<
  TMetadata extends ErrorMetadata = ErrorMetadata,
> extends ExpoError<TMetadata> {
  public innerError?: Error;

  constructor(message: string, details: BuildErrorDetails<TMetadata>) {
    super(message, {
      errorCode: details.errorCode,
      trackingCode: details.trackingCode,
      docsUrl: details.docsUrl,
      buildPhase: details.buildPhase,
      metadata: details.metadata,
      cause: details.innerError ?? details.cause,
    });
    this.innerError = details.innerError ?? details.cause;
  }
}

export class UserFacingError<
  TMetadata extends ErrorMetadata = ErrorMetadata,
> extends ExpoError<TMetadata> {
  constructor(
    public errorCode: string,
    public message: string,
    options?: {
      docsUrl?: string;
      metadata?: TMetadata;
      cause?: Error;
    }
  ) {
    super(message, {
      errorCode,
      docsUrl: options?.docsUrl,
      metadata: options?.metadata,
      cause: options?.cause,
    });
  }
}

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
    });
  }
}

export class UnknownCustomBuildError extends BuildError {
  constructor() {
    const errorCode = ErrorCode.UNKNOWN_CUSTOM_BUILD_ERROR;
    const message = 'Unknown custom build error. See logs for more information.';
    super(message, {
      errorCode,
    });
  }
}

export class CredentialsDistCertMismatchError extends UserFacingError {
  constructor(message: string) {
    super('EAS_BUILD_CREDENTIALS_DIST_CERT_MISMATCH', message);
  }
}
