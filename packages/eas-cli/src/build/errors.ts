export class TurtleDeprecatedJobFormatError extends Error {
  constructor(message?: string) {
    super(message ?? 'Deprecated job format.');
  }
}

export class EasBuildFreeTierDisabledError extends Error {
  constructor(message?: string) {
    super(message ?? 'Eas-build free tier is disabled.');
  }
}

export class EasBuildFreeTierDisabledIOSError extends Error {
  constructor(message?: string) {
    super(message ?? 'Eas-build free tier is disabled for iOS.');
  }
}

export class EasBuildFreeTierDisabledAndroidError extends Error {
  constructor(message?: string) {
    super(message ?? 'Eas-build free tier is disabled for Android.');
  }
}

export class RequestValidationError extends Error {
  constructor(message?: string) {
    super(message ?? 'Request validation error.');
  }
}

export class EasBuildDownForMaintenanceError extends Error {
  constructor(message?: string) {
    super(message ?? 'Eas-build is currently down for maintenance.');
  }
}

export class EasBuildTooManyPendingBuildsError extends Error {
  constructor(message?: string) {
    super(message ?? 'Eas-build has too many pending builds at the moment.');
  }
}

export class GenericGraphQLError extends Error {
  constructor(message?: string) {
    super(message ?? 'GraphQL query failed.');
  }
}
