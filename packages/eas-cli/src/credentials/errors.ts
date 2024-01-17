export class MissingCredentialsNonInteractiveError extends Error {
  constructor(message?: string) {
    super(message ?? 'Credentials are not set up. Run this command again in interactive mode.');
  }
}

export class MissingCredentialsError extends Error {
  constructor(message?: string) {
    super(message ?? 'Credentials are not set up.');
  }
}

export class UnsupportedCredentialsChoiceError extends Error {
  constructor(
    message: string,
    public choice: string
  ) {
    super(message);
  }
}

export class AndroidPackageNotDefinedError extends Error {
  constructor(message?: string) {
    super(message ?? 'android.package needs to be defined in your app.json/app.config.js file');
  }
}
