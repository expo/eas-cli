export interface EasCommandErrorDetails {
  accountName?: string;
  accountsWithProjectCreationPermission: string[];
}

export class EasCommandError extends Error {
  /** True when the command already printed the message, so `EasCommand.catch` must not print it again. */
  public readonly messageAlreadyPrinted: boolean;
  /** A stable identifier, printed in the `--json` error output so programs need not match the message. */
  public readonly code?: string;

  public readonly details?: EasCommandErrorDetails;

  constructor(
    message: string,
    {
      messageAlreadyPrinted = false,
      code,
      details,
    }: { messageAlreadyPrinted?: boolean; code?: string; details?: EasCommandErrorDetails } = {}
  ) {
    super(message);
    this.messageAlreadyPrinted = messageAlreadyPrinted;
    this.code = code;
    this.details = details;
  }
}
