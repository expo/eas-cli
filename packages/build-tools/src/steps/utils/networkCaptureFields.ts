import { UserError } from '@expo/eas-build-job';
import { BuildRuntimePlatform } from '@expo/steps';

/** A JSON step input is whatever the workflow author wrote, so its shape has to be checked. */
export function parseNetworkCaptureFieldsInput(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(field => typeof field === 'string')) {
    throw new UserError(
      'EAS_NETWORK_CAPTURE_INVALID_INPUT',
      'Input "network_capture_fields" must be an array of strings.'
    );
  }
  return value;
}

export function parseNetworkCaptureInputs(
  {
    networkCapture,
    networkCaptureFields,
  }: { networkCapture?: unknown; networkCaptureFields?: unknown },
  { runtimePlatform }: { runtimePlatform: BuildRuntimePlatform }
): { networkCapture: boolean; networkCaptureFields: string[] } {
  const fields = parseNetworkCaptureFieldsInput(networkCaptureFields);
  if (networkCapture === true && runtimePlatform !== BuildRuntimePlatform.DARWIN) {
    throw new UserError(
      'EAS_NETWORK_CAPTURE_UNSUPPORTED_PLATFORM',
      `Input "network_capture" records traffic through serve-sim on an iOS simulator, and this session runs on ${runtimePlatform}. Run the session on an iOS simulator, or drop "network_capture".`
    );
  }
  return { networkCapture: networkCapture === true, networkCaptureFields: fields };
}
