export class MissingCredentialsNonInteractiveError extends Error {
  constructor(message?: string) {
    super(
      message ?? 'Credentials are not set up. Please run this command again in interactive mode.'
    );
  }
}

export class MissingCredentialsError extends Error {
  constructor(message?: string) {
    super(message ?? 'Credentials are not set up.');
  }
}

export class UnsupportedCredentialsChoiceError extends Error {
  constructor(message: string, public choice: string) {
    super(message);
  }
}
