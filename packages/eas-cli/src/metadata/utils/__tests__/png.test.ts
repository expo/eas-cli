import { isPngEquivalent } from '../png';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // The comparison never validates CRCs, so a zeroed CRC keeps fixtures simple.
  const crc = Buffer.alloc(4);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, crc]);
}

function png(...chunks: Buffer[]): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

const ihdr = chunk('IHDR', Buffer.alloc(13, 1));
const idat = chunk('IDAT', Buffer.from('pixel-data'));
const otherIdat = chunk('IDAT', Buffer.from('other-pixels'));
const iend = chunk('IEND', Buffer.alloc(0));

describe(isPngEquivalent, () => {
  it('returns true for byte-identical buffers', () => {
    const image = png(ihdr, idat, iend);
    expect(isPngEquivalent(image, Buffer.from(image))).toBe(true);
  });

  it('returns true when images differ only in iTXt and eXIf metadata chunks', () => {
    // App Store Connect stamps a unique asset resource ID into the XMP (iTXt)
    // and EXIF (eXIf) chunks on every download.
    const first = png(
      ihdr,
      chunk('eXIf', Buffer.from('asset-id-AAAAAAAAAAAAAAAAAAAAAAAAAA')),
      idat,
      chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0dc:creator=AAAA')),
      iend
    );
    const second = png(
      ihdr,
      chunk('eXIf', Buffer.from('asset-id-BBBBBBBBBBBBBBBBBBBBBBBBBB')),
      idat,
      chunk('iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0dc:creator=BBBB')),
      iend
    );
    expect(isPngEquivalent(first, second)).toBe(true);
  });

  it('returns true when one image has metadata chunks and the other has none', () => {
    const withMetadata = png(ihdr, chunk('tEXt', Buffer.from('Comment\0hello')), idat, iend);
    const withoutMetadata = png(ihdr, idat, iend);
    expect(isPngEquivalent(withMetadata, withoutMetadata)).toBe(true);
  });

  it('returns false when pixel data differs', () => {
    expect(isPngEquivalent(png(ihdr, idat, iend), png(ihdr, otherIdat, iend))).toBe(false);
  });

  it('returns false when a non-volatile chunk differs', () => {
    const first = png(ihdr, chunk('PLTE', Buffer.from([1, 2, 3])), idat, iend);
    const second = png(ihdr, chunk('PLTE', Buffer.from([4, 5, 6])), idat, iend);
    expect(isPngEquivalent(first, second)).toBe(false);
  });

  it('falls back to byte equality for non-PNG buffers', () => {
    const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(isPngEquivalent(jpegish, Buffer.from(jpegish))).toBe(true);
    expect(isPngEquivalent(jpegish, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]))).toBe(false);
  });

  it('returns false for a truncated PNG against a valid one', () => {
    const valid = png(ihdr, idat, iend);
    expect(isPngEquivalent(valid, valid.subarray(0, valid.length - 6))).toBe(false);
  });
});
