import type { bunyan } from '@expo/logger';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createScreenshotMetadataAsync,
  readImageSize,
} from '../deviceRunSessionScreenshotMetadata';

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function webp(chunk: string, data: Buffer): Buffer {
  const header = Buffer.alloc(20);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(12 + data.length, 4);
  header.write('WEBP', 8, 'latin1');
  header.write(chunk, 12, 'latin1');
  header.writeUInt32LE(data.length, 16);
  return Buffer.concat([header, data]);
}

function vp8(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(data, 3);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return webp('VP8 ', data);
}

function vp8l(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data[0] = 0x2f;
  data.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return webp('VP8L', data);
}

function vp8x(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return webp('VP8X', data);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function jpegFrame(marker: number, width: number, height: number, components = 3): Buffer {
  const payload = Buffer.alloc(6 + 3 * components);
  payload[0] = 8;
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  payload[5] = components;
  return jpegSegment(marker, payload);
}

const JPEG_START = Buffer.from([0xff, 0xd8]);

describe(readImageSize, () => {
  it('reads the PNG IHDR size', () => {
    expect(readImageSize(png(1179, 2556))).toEqual({ width: 1179, height: 2556 });
  });

  it('reads the lossy WebP frame size without its scale bits', () => {
    expect(readImageSize(vp8(0x4000 | 1179, 0xc000 | 2556))).toEqual({
      width: 1179,
      height: 2556,
    });
  });

  it('reads the lossless WebP size', () => {
    expect(readImageSize(vp8l(1179, 2556))).toEqual({ width: 1179, height: 2556 });
  });

  it('reads the size of a minimal lossless WebP shorter than other WebP headers', () => {
    const minimalLossless = Buffer.from(
      '5249464614000000574542505650384c080000002f0fc00310888808',
      'hex'
    );
    expect(readImageSize(minimalLossless)).toEqual({ width: 16, height: 16 });
  });

  it('reads the extended WebP canvas size', () => {
    expect(readImageSize(vp8x(1179, 2556))).toEqual({ width: 1179, height: 2556 });
  });

  it('reads the JPEG frame size after other segments', () => {
    const jpeg = Buffer.concat([
      JPEG_START,
      jpegSegment(0xe1, Buffer.alloc(300)),
      Buffer.from([0xff]),
      jpegSegment(0xc4, Buffer.alloc(20)),
      jpegFrame(0xc2, 1179, 2556),
    ]);
    expect(readImageSize(jpeg)).toEqual({ width: 1179, height: 2556 });
  });

  it.each([
    ['an empty buffer', Buffer.alloc(0)],
    ['a truncated PNG', png(1179, 2556).subarray(0, 20)],
    ['a PNG without IHDR first', Buffer.concat([png(1, 1).subarray(0, 12), Buffer.alloc(21)])],
    ['a zero-width PNG', png(0, 2556)],
    ['a truncated WebP', vp8x(1179, 2556).subarray(0, 26)],
    ['a WebP with an unknown chunk', webp('ALPH', Buffer.alloc(10))],
    ['a lossy WebP without a start code', webp('VP8 ', Buffer.alloc(10))],
    [
      'a JPEG truncated in its frame header',
      Buffer.concat([JPEG_START, jpegFrame(0xc0, 1179, 2556)]).subarray(0, 8),
    ],
    [
      'a JPEG truncated before its frame',
      Buffer.concat([JPEG_START, jpegSegment(0xe1, Buffer.alloc(300))]),
    ],
    [
      'a JPEG with scan data before a frame',
      Buffer.concat([JPEG_START, jpegSegment(0xda, Buffer.alloc(10)), jpegFrame(0xc0, 1, 1)]),
    ],
    [
      'a JPEG frame without components',
      Buffer.concat([JPEG_START, jpegFrame(0xc0, 1179, 2556, 0)]),
    ],
    ['a JPEG frame shorter than its header', Buffer.from('ffd8ffc0000208049b09fc', 'hex')],
    ['a JPEG frame longer than the read bytes', Buffer.from('ffd8ffc0ffff08049b09fc', 'hex')],
    [
      'a JPEG frame whose length does not match its components',
      Buffer.concat([
        JPEG_START,
        jpegSegment(
          0xc0,
          Buffer.concat([Buffer.from([8, 0x09, 0xfc, 0x04, 0x9b, 3]), Buffer.alloc(6)])
        ),
      ]),
    ],
    ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1')],
    ['a log file', Buffer.from('2026-11-10T12:00:00Z app started\n'.repeat(4))],
  ])('returns undefined for %s', (_description, header) => {
    expect(readImageSize(header)).toBeUndefined();
  });
});

describe(createScreenshotMetadataAsync, () => {
  let directory: string;
  let logger: bunyan;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'screenshot-metadata-test-'));
    logger = { warn: jest.fn() } as unknown as bunyan;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('adds the image size to the screenshot metadata', async () => {
    const file = path.join(directory, 'shot.png');
    await writeFile(file, Buffer.concat([png(1179, 2556), Buffer.alloc(128 * 1024)]));
    await expect(
      createScreenshotMetadataAsync(file, {
        source: 'agent-device',
        displayRotation: 'landscape-left',
        logger,
      })
    ).resolves.toEqual({
      source: 'agent-device',
      displayRotation: 'landscape-left',
      width: 1179,
      height: 2556,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns and leaves out the size when the header is not a supported image', async () => {
    const file = path.join(directory, 'shot.png');
    await writeFile(file, 'not-an-image');
    await expect(
      createScreenshotMetadataAsync(file, { source: 'manual', logger })
    ).resolves.toEqual({ source: 'manual' });
    expect(logger.warn).toHaveBeenCalledWith(
      { file },
      'Uploading the screenshot without its width and height because it does not start with a complete PNG, WebP or JPEG header.'
    );
  });

  it('warns and leaves out the size when the file cannot be read', async () => {
    const file = path.join(directory, 'missing.png');
    await expect(
      createScreenshotMetadataAsync(file, { source: 'manual', logger })
    ).resolves.toEqual({ source: 'manual' });
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ code: 'ENOENT' }), file },
      'Uploading the screenshot without its width and height because its header could not be read.'
    );
  });
});
