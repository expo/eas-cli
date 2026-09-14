import { UserError } from '@expo/eas-build-job';

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
