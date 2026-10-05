export class GooglePlayApiError extends Error {
  constructor(
    readonly status: number,
    readonly apiMessage: string,
    readonly reasons: string[]
  ) {
    super(`Google Play request failed (HTTP ${status}).`);
  }
}

export class GooglePlayNetworkError extends Error {
  constructor() {
    super('Google Play request failed before a response was received.');
  }
}
