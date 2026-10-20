export class EasCommandError extends Error {
  /** True when the command already printed the message, so `EasCommand.catch` must not print it again. */
  public readonly messageAlreadyPrinted: boolean;

  constructor(
    message: string,
    { messageAlreadyPrinted = false }: { messageAlreadyPrinted?: boolean } = {}
  ) {
    super(message);
    this.messageAlreadyPrinted = messageAlreadyPrinted;
  }
}
