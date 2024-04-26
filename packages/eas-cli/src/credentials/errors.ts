import { learnMore } from '../log';

export class MissingCredentialsNonInteractiveError extends Error {
  constructor(message?: string) {
    super(message ?? 'Credentials are not set up. Run this command again in interactive mode.');
  }
}

export class InsufficientAuthenticationNonInteractiveError extends Error {
  constructor(message?: string) {
    super(
      message ??
        `Authentication with an ASC API key is required in non-interactive mode. ${learnMore(
          'https://docs.expo.dev/build/building-on-ci/#optional-provide-an-asc-api-token-for-your-apple-team'
        )}`
    );
  }
}

export class ForbidCredentialModificationError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Credentials cannot be modified. Run this command again without the --freeze-credentials flag.'
    );
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
