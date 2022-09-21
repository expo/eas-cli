export class DeviceNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'Device not found.');
  }
}
