export const GIF_HEADER_BYTES = 6;

// GIF89a section 17 (Header): https://www.w3.org/Graphics/GIF/spec-gif89a.txt
export function isGif(header: Buffer): boolean {
  if (header.byteLength < GIF_HEADER_BYTES) {
    return false;
  }

  return ['GIF87a', 'GIF89a'].includes(header.toString('latin1', 0, 6));
}
