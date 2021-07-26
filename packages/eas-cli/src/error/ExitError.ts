export class ExitError extends Error {
  constructor(message?: string, public errorCode: number = 1) {
    super(message);
  }
}
