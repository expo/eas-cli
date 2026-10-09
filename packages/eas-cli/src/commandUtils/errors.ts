export class EasCommandError extends Error {
  /** A stable identifier, printed in the `--json` error output so programs need not match the message. */
  public readonly code?: string;

  constructor(message: string, { code }: { code?: string } = {}) {
    super(message);
    this.code = code;
  }
}
