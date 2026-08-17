abstract class UserError extends Error {
  public readonly cause?: Error;
  public readonly metadata: object;

  constructor(
    public override readonly message: string,
    extra?: {
      metadata?: object;
      cause?: Error;
    }
  ) {
    super(message);
    this.metadata = extra?.cause ?? {};
    this.cause = extra?.cause;
  }
}

export class BuildConfigError extends UserError {}

export { YAMLParseError as BuildConfigYAMLError } from 'yaml';

export class BuildInternalError extends Error {}

export class BuildStepRuntimeError extends UserError {}

// Unevaluable `if:` gate. Carries the failed condition so catch sites do not
// blame a nearby step's `if:`. `reported` logs the rethrow once.
export class BuildStepConditionEvaluationError extends UserError {
  public reported = false;

  constructor(
    public override readonly message: string,
    public readonly subject: string,
    public readonly ifCondition: string,
    extra?: {
      cause?: Error;
    }
  ) {
    super(message, extra);
  }
}

export class BuildWorkflowError extends UserError {
  constructor(
    public override readonly message: string,
    public readonly errors: BuildConfigError[],
    extra?: {
      metadata?: object;
      cause?: Error;
    }
  ) {
    super(message, extra);
  }
}
