import fs from 'node:fs';
import { Readable } from 'node:stream';
import { extract } from 'tar-stream';
import zlib from 'node:zlib';

import { FileEntry, packFilesIterableAsync } from '../assets';

async function extractTarEntriesAsync(tarData: Buffer): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const extractor = extract();
  extractor.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
      entries.set(header.name, Buffer.concat(chunks).toString('utf8'));
      next();
    });
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extractor.on('finish', resolve);
    extractor.on('error', reject);
    Readable.from(tarData).pipe(extractor);
  });
  return entries;
}

describe(packFilesIterableAsync, () => {
  let tarPath: string | null = null;

  afterEach(async () => {
    if (tarPath) {
      await fs.promises.rm(tarPath, { force: true });
      tarPath = null;
    }
  });

  it('packs file entries into a gzip-compressed tarball', async () => {
    const files: FileEntry[] = [
      ['index.html', '<h1>hello</h1>'],
      ['assets/data.json', '{"key":"value"}'],
    ];
    tarPath = await packFilesIterableAsync(files);

    const compressed = await fs.promises.readFile(tarPath);
    // gzip magic bytes
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
    // portable mode zeroes the gzip MTIME field (bytes 4-7)
    expect(compressed.subarray(4, 8)).toEqual(Buffer.from([0, 0, 0, 0]));

    const entries = await extractTarEntriesAsync(zlib.gunzipSync(compressed));
    expect(entries.get('index.html')).toBe('<h1>hello</h1>');
    expect(entries.get('assets/data.json')).toBe('{"key":"value"}');
    expect(entries.size).toBe(2);
  });

  it('accepts async iterables and forwards gzip options', async () => {
    async function* files(): AsyncIterable<FileEntry> {
      yield ['a.txt', 'aaaa'];
      yield ['b.txt', Buffer.from('bbbb')];
    }
    tarPath = await packFilesIterableAsync(files(), { level: 9 });

    const compressed = await fs.promises.readFile(tarPath);
    const entries = await extractTarEntriesAsync(zlib.gunzipSync(compressed));
    expect(entries.get('a.txt')).toBe('aaaa');
    expect(entries.get('b.txt')).toBe('bbbb');
  });
});
