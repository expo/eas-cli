export const WEBP_HEADER_BYTES = 12;

// https://www.rfc-editor.org/rfc/rfc9649#section-2.4
export function isWebp(header: Buffer): boolean {
  if (header.byteLength < WEBP_HEADER_BYTES) {
    return false;
  }

  return header.toString('latin1', 0, 4) === 'RIFF' && header.toString('latin1', 8, 12) === 'WEBP';
}
