// SOI marker followed by the next marker, ITU-T T.81 B.1.1.3: https://www.w3.org/Graphics/JPEG/itu-t81.pdf (page 32)
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
export const JPEG_HEADER_BYTES = JPEG_SIGNATURE.byteLength;

export function isJpeg(header: Buffer): boolean {
  if (header.byteLength < JPEG_HEADER_BYTES) {
    return false;
  }

  return header.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
}
