import { IMAGE_HEADER_BYTES, detectFileTypeFromHeader } from '..';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytes(...parts: (number[] | string)[]): Buffer {
  return Buffer.concat(
    parts.map(part => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part)))
  );
}

function header(...parts: (number[] | string)[]): Buffer {
  return Buffer.concat([bytes(...parts), Buffer.alloc(IMAGE_HEADER_BYTES, 0xaa)]).subarray(
    0,
    IMAGE_HEADER_BYTES
  );
}

describe(detectFileTypeFromHeader.name, () => {
  it.each([
    ['PNG', 'image/png', header(PNG_SIGNATURE, [0x00, 0x00, 0x00, 0x0d], 'IHDR')],
    ['JFIF JPEG', 'image/jpeg', header([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF')],
    ['EXIF JPEG', 'image/jpeg', header([0xff, 0xd8, 0xff, 0xe1, 0x12, 0x34], 'Exif')],
    ['GIF87a', 'image/gif', header('GIF87a', [0x01, 0x00, 0x01, 0x00])],
    ['GIF89a', 'image/gif', header('GIF89a', [0x01, 0x00, 0x01, 0x00])],
    ['WebP', 'image/webp', header('RIFF', [0x24, 0x10, 0x00, 0x00], 'WEBP', 'VP8 ')],
  ])('detects a %s header followed by image data', (_, mimeType, contents) => {
    expect(detectFileTypeFromHeader(contents)).toBe(mimeType);
  });

  it.each([
    ['an empty file', bytes()],
    ['text', header('export const')],
    ['a PNG signature that is cut short', bytes(PNG_SIGNATURE.slice(0, -1))],
    ['a JPEG SOI marker without a following marker', bytes([0xff, 0xd8])],
    ['a GIF signature that is cut short', bytes('GIF89')],
    ['a WebP header that is cut short', bytes('RIFF', [0x24, 0x10, 0x00, 0x00], 'WEB')],
    ['a PNG signature with one changed byte', header(PNG_SIGNATURE.slice(0, -1), [0x0b])],
    ['a PNG signature that does not start at the first byte', header([0x00], PNG_SIGNATURE)],
    ['a JPEG SOI marker followed by a non-marker byte', header([0xff, 0xd8, 0x00, 0xe0])],
    ['an unknown GIF version', header('GIF88a', [0x01, 0x00, 0x01, 0x00])],
    ['a RIFF file that is not WebP', header('RIFF', [0x24, 0x10, 0x00, 0x00], 'WAVE')],
    ['a big-endian RIFX file', header('RIFX', [0x00, 0x00, 0x10, 0x24], 'WEBP')],
  ])('does not detect an image in %s', (_, contents) => {
    expect(detectFileTypeFromHeader(contents)).toBe(null);
  });
});
