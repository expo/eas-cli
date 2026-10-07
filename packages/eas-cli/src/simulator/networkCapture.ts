export const NETWORK_CAPTURE_FIELDS = ['header', 'query', 'request-body', 'response-body'] as const;

export type NetworkCaptureField = (typeof NETWORK_CAPTURE_FIELDS)[number];

/**
 * Resolve `--network-capture-field` the way serve-sim's own flag does: comma-separated values are
 * accepted, and the name is matched case-insensitively.
 */
export function parseNetworkCaptureFields(entries: readonly string[]): NetworkCaptureField[] {
  const fields = entries
    .flatMap(entry => entry.split(','))
    .map(field => field.trim().toLowerCase());
  if (fields.some(field => field.length === 0)) {
    throw new Error(
      `Empty network capture field. Choose from: ${NETWORK_CAPTURE_FIELDS.join(', ')}.`
    );
  }
  const unknown = fields.find(
    field => !NETWORK_CAPTURE_FIELDS.includes(field as NetworkCaptureField)
  );
  if (unknown !== undefined) {
    throw new Error(
      `Unknown network capture field '${unknown}'. Supported: ${NETWORK_CAPTURE_FIELDS.join(', ')}.`
    );
  }
  return [...new Set(fields as NetworkCaptureField[])];
}
