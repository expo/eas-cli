const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Ancillary PNG chunks that carry text or timestamp metadata, but no pixel data.
 * App Store Connect embeds a unique asset resource ID into these chunks
 * (`eXIf` UserComment and `iTXt` XMP) every time an asset is downloaded, so
 * they differ between byte-identical images.
 */
const VOLATILE_CHUNK_TYPES = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

type PngChunk = {
  type: string;
  data: Buffer;
};

/**
 * Parses the chunk sequence of a PNG buffer.
 * Returns null when the buffer is not a structurally valid PNG.
 */
function parsePngChunks(buffer: Buffer): PngChunk[] | null {
  if (buffer.length < PNG_SIGNATURE.length + 12) {
    return null;
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < buffer.length) {
    // Each chunk is: 4-byte length, 4-byte type, `length` bytes of data, 4-byte CRC.
    if (offset + 12 > buffer.length) {
      return null;
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      return null;
    }
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }

  return chunks;
}

/**
 * Compares two PNG buffers, ignoring volatile metadata chunks (`tEXt`, `zTXt`,
 * `iTXt`, `eXIf`, `tIME`). Two PNGs are considered equivalent when their
 * remaining chunk sequences — including all pixel data — are identical.
 *
 * Falls back to plain byte equality when either buffer is not a valid PNG.
 */
export function isPngEquivalent(a: Buffer, b: Buffer): boolean {
  if (a.equals(b)) {
    return true;
  }

  const chunksA = parsePngChunks(a);
  const chunksB = parsePngChunks(b);
  if (chunksA == null || chunksB == null) {
    return false;
  }

  const stableA = chunksA.filter(chunk => !VOLATILE_CHUNK_TYPES.has(chunk.type));
  const stableB = chunksB.filter(chunk => !VOLATILE_CHUNK_TYPES.has(chunk.type));

  return (
    stableA.length === stableB.length &&
    stableA.every(
      (chunk, index) => chunk.type === stableB[index].type && chunk.data.equals(stableB[index].data)
    )
  );
}
