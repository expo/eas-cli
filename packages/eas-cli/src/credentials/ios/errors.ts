export class AppleTeamMissingError extends Error {
  constructor(message?: string) {
    super(message ?? 'You need to be authenticated with Apple to set up credentials');
  }
}

export class MissingCredentialsNonInteractiveError extends Error {
  constructor(message?: string) {
    super(
      message ?? 'Credentials are not set up. Please run this command again in interactive mode.'
    );
  }
}
