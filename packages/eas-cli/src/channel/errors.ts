export class ChannelNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'Channel not found.');
  }
}
