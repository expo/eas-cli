export class DeviceNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? 'Device not found.');
  }
}

export class DeviceCreateError extends Error {
  constructor(message?: string) {
    super(message ?? 'Failed to create a device.');
  }
}
