import { OperationTimeoutError, withTimeoutAsync } from '../../utils/timeout';

export class DeviceRunSessionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceRunSessionTimeoutError';
  }
}

export async function withDeviceRunSessionTimeoutAsync<T>(
  options: { name: string; timeoutMs: number; signal?: AbortSignal },
  operation: (signal: AbortSignal, resetDeadline: () => void) => Promise<T>
): Promise<T> {
  try {
    return await withTimeoutAsync(options, operation);
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      throw new DeviceRunSessionTimeoutError(error.message);
    }
    throw error;
  }
}
