export class EasCommandError extends Error {
  constructor(message?: string) {
    super(message ?? 'Unknown EAS error occurred.');
  }
}

export class TurtleDeprecatedJobFormatError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'Deprecated job format.');
  }
}

export class EasBuildFreeTierDisabledError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'EAS Build free tier is disabled.');
  }
}

export class EasBuildFreeTierDisabledIOSError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'EAS Build free tier is disabled for iOS.');
  }
}

export class EasBuildFreeTierDisabledAndroidError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'EAS Build free tier is disabled for Android.');
  }
}

export class RequestValidationError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'Request validation error.');
  }
}

export class EasBuildDownForMaintenanceError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'EAS Build is currently down for maintenance.');
  }
}

export class EasBuildTooManyPendingBuildsError extends EasCommandError {
  constructor(message?: string) {
    super(message ?? 'EAS Build has too many pending builds at the moment.');
  }
}
