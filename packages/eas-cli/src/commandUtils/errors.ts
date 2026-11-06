export class EasCommandError extends Error {
  /** True when the command already printed the message, so `EasCommand.catch` must not print it again. */
  public readonly messageAlreadyPrinted: boolean;
  /** A stable identifier, printed in the `--json` error output so programs need not match the message. */
  public readonly code?: string;

  constructor(
    message: string,
    { messageAlreadyPrinted = false, code }: { messageAlreadyPrinted?: boolean; code?: string } = {}
  ) {
    super(message);
    this.messageAlreadyPrinted = messageAlreadyPrinted;
    this.code = code;
  }
}
