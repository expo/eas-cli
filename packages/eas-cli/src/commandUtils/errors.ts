export class EasCommandError extends Error {
  // constructor is not useless, since the constructor for Error allows for optional `message`
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(message: string) {
    super(message);
  }
}
