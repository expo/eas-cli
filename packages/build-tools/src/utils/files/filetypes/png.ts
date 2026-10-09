// https://www.w3.org/TR/png-3/#3PNGsignature
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const PNG_HEADER_BYTES = PNG_SIGNATURE.byteLength;

export function isPng(header: Buffer): boolean {
  if (header.byteLength < PNG_HEADER_BYTES) {
    return false;
  }

  return header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}
