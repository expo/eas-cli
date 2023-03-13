export class EasCommandError extends Error {
  constructor(message?: string) {
    super(message ?? 'Unknown EAS error occurred.');
  }
}
