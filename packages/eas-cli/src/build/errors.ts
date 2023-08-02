import { EasCommandError } from '../commandUtils/errors';

export class TurtleDeprecatedJobFormatError extends EasCommandError {}

export class EasBuildFreeTierDisabledError extends EasCommandError {}

export class EasBuildFreeTierDisabledIOSError extends EasCommandError {}

export class EasBuildFreeTierDisabledAndroidError extends EasCommandError {}

export class EasBuildFreeTierLimitExceededError extends EasCommandError {}

export class EasBuildFreeTierIosLimitExceededError extends EasCommandError {}

export class EasBuildResourceClassNotAvailableInFreeTierError extends EasCommandError {}

export class EasBuildLegacyResourceClassNotAvailableError extends EasCommandError {}

export class RequestValidationError extends EasCommandError {}

export class EasBuildDownForMaintenanceError extends EasCommandError {}

export class EasBuildTooManyPendingBuildsError extends EasCommandError {}

export class EasBuildProjectArchiveUploadError extends EasCommandError {}
