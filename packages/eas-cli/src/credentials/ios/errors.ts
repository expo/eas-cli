export class AppleTeamMissingError extends Error {
  constructor(message?: string) {
    super(message ?? 'Apple Team is necessary to create Apple App Identifier');
  }
}
