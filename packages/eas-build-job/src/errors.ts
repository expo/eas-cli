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

interface ExpoErrorDetails {
  errorCode: string;
  trackingCode?: string;
  docsUrl?: string;
  cause?: unknown;
  buildPhase?: BuildPhase;
}

interface BuildErrorDetails extends ExpoErrorDetails {
  innerError?: Error;
}

export class ExpoError extends Error {
  public errorCode: string;
  // Internal-only classification used for Sentry, analytics, and worker internalErrorCode.
  // The public error saved on builds and job runs is always `errorCode`.
  public trackingCode?: string;
  public docsUrl?: string;
  public override readonly cause?: unknown;
  public buildPhase?: BuildPhase;

  constructor(message: string, details: ExpoErrorDetails) {
    super(message, { cause: details.cause });
    this.errorCode = details.errorCode;
    this.trackingCode = details.trackingCode;
    this.docsUrl = details.docsUrl;
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

export class BuildError extends ExpoError {
  public innerError?: Error;

  constructor(message: string, details: BuildErrorDetails) {
    super(message, {
      errorCode: details.errorCode,
      trackingCode: details.trackingCode,
      docsUrl: details.docsUrl,
      buildPhase: details.buildPhase,
      cause: details.innerError,
    });
    this.innerError = details.innerError;
  }
}

export class UserFacingError extends ExpoError {
  constructor(
    public errorCode: string,
    public message: string,
    options?: { docsUrl?: string; cause?: unknown }
  ) {
    super(message, {
      errorCode,
      docsUrl: options?.docsUrl,
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
