export class AppleTeamMissingError extends Error {
  constructor(message?: string) {
    super(message ?? 'Apple Team is necessary to create Apple App Identifier');
  }
}

export class MissingCredentialsNonInteractiveError extends Error {
  constructor(message?: string) {
    super(
      message ?? 'Credentials are not set up. Please run this command again in interactive mode.'
    );
  }
}
