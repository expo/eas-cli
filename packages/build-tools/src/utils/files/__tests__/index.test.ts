import { vol } from 'memfs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';

import { decompressTarAsync, isFileTarGzAsync, isMacOsArchiveMetadataEntry } from '..';

// contains a 'hello.txt' file with 'hello' content
const HELLO_TAR_GZ_BUFFER = Buffer.from(
  'H4sIACyzHGgAA9PTZ6A5MDAwMDc1VQDTZhDawMgEQkOBgqEpUNLQ2NDExFTBwNDI2NCUQcGU9k5jYCgtLkksAjqlOCs5IzczNScRhzqgsrQ0POZA/QGnhwjQ0w9ydXTxddXLTaGZHcDwMDMxwRf/Zoj4NzIHxr+xqbkBg4IBzVyEBEZ4/Gek5uTkcw20K0bBQAE9fXAK0ANmAr30KtrYQSD/G2KW/yamxmaj+Z8eQL6bg0F1s0wGA/Pbqd58TQYCbbu/idg6zrRju6a2qeQx76pFHQouJal7dod2rnfp7WyVeH77TNMy2R+n/igl3GNs4Jg4P6ti3YIzO80KOt8tvHJJ4onC1GknLH7l927M3bsx+7rXXN9LSROffDtptT3HrHqj/2e56b+UOxJEvrMfjhAJzk/f8V5Q6vOp+oqv65Wexyez9DRv78v7Ufw/c9Lz1PWv9TrWCTSuXXUrn6PG5P9dnYL/+51m/V974Yf+qY9K/jaxzf1/Xif/kw5R/JnfXP1/6lydtzaCkbHr9pUf+/3nOv8/ZYYlf/Kb7847NF+B45G8JQPT5FmMDEIDHd6DDejpJxYUFNO2EUhS+w/YFgDW/0amo+0/ugBo/OfmJ2XmpNIoGZAU/8aQ8t/IbDT+6QFQ478gMTk7MT1VL6s4P496dhBu/xujxb+5gYHpaP1PD1BdO9r4HwWjYBSMgpEIANczH2UAFg' +
    Array.from({ length: 652 }, () => 'A') +
    '==',
  'base64'
);

describe('isFileTarGzAsync', () => {
  it('should return true for a tar.gz-named file', async () => {
    vol.fromJSON({
      'test.tar.gz': 'whatever',
    });

    const result = await isFileTarGzAsync('test.tar.gz');
    expect(result).toBe(true);
  });

  it('should return true for a tar.gz file', async () => {
    vol.fromJSON({
      test: HELLO_TAR_GZ_BUFFER,
    });

    const result = await isFileTarGzAsync('test');
    expect(result).toBe(true);
  });

  it('should return false for a non-tar.gz file', async () => {
    vol.fromJSON({
      'test.txt': 'Hello, world!',
    });

    const result = await isFileTarGzAsync('test.txt');
    expect(result).toBe(false);
  });
});

describe('isMacOsArchiveMetadataEntry', () => {
  it.each([
    '._MyApp.app',
    './._MyApp.app',
    'MyApp.app/._Info.plist',
    'MyApp.app/PlugIns/._CommasNotificationServiceExtension.appex',
    '__MACOSX/',
    '__MACOSX/MyApp.app/._Info.plist',
    './__MACOSX/MyApp.app',
    'nested/__MACOSX/file.txt',
  ])('returns true for macOS metadata entry %s', entryPath => {
    expect(isMacOsArchiveMetadataEntry(entryPath)).toBe(true);
  });

  it.each([
    'MyApp.app',
    'MyApp.app/Info.plist',
    'MyApp.app/.hidden',
    'MyApp.app/foo._bar',
    'MyApp.app/_underscore',
    'MyApp.app/resource\\._part',
    'MyApp.app/PlugIns/CommasNotificationServiceExtension.appex',
  ])('returns false for regular entry %s', entryPath => {
    expect(isMacOsArchiveMetadataEntry(entryPath)).toBe(false);
  });
});

describe('decompressTarAsync', () => {
  it('should decompress a tar.gz file', async () => {
    vol.fromNestedJSON({
      'test.tar.gz': HELLO_TAR_GZ_BUFFER,
      test: {},
    });

    await decompressTarAsync({
      archivePath: 'test.tar.gz',
      destinationDirectory: 'test',
    });

    expect(vol.readFileSync('test/README.md', 'utf8')).toBe('hello\n');
    expect(vol.readFileSync('test/apps/mobile/package.json', 'utf8')).toBe('{}\n');
  });

  it('skips entries excluded by the filter option', async () => {
    const sourceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tar-filter-src-'));
    const archivePath = path.join(os.tmpdir(), `${randomUUID()}.tar.gz`);
    const filteredDestDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tar-filter-dest-'));
    const unfilteredDestDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'tar-unfiltered-dest-')
    );

    await fs.promises.mkdir(path.join(sourceDir, 'MyApp.app', 'PlugIns'), { recursive: true });
    await fs.promises.mkdir(path.join(sourceDir, '__MACOSX', 'MyApp.app'), { recursive: true });
    await fs.promises.writeFile(path.join(sourceDir, '._MyApp.app'), 'appledouble');
    await fs.promises.writeFile(path.join(sourceDir, 'MyApp.app', 'MyApp'), 'binary');
    await fs.promises.writeFile(path.join(sourceDir, 'MyApp.app', 'resource\\._part'), 'literal');
    await fs.promises.writeFile(
      path.join(sourceDir, 'MyApp.app', 'PlugIns', '._Ext.appex'),
      'appledouble-ext'
    );
    await fs.promises.writeFile(
      path.join(sourceDir, '__MACOSX', 'MyApp.app', '._MyApp'),
      'macosx-meta'
    );

    await tar.create(
      {
        cwd: sourceDir,
        file: archivePath,
        gzip: true,
      },
      ['._MyApp.app', 'MyApp.app', '__MACOSX']
    );

    await decompressTarAsync({
      archivePath,
      destinationDirectory: filteredDestDir,
      filter: entryPath => !isMacOsArchiveMetadataEntry(entryPath),
    });

    expect(
      await fs.promises.readFile(path.join(filteredDestDir, 'MyApp.app', 'MyApp'), 'utf8')
    ).toBe('binary');
    expect(
      await fs.promises.readFile(
        path.join(filteredDestDir, 'MyApp.app', 'resource\\._part'),
        'utf8'
      )
    ).toBe('literal');
    expect(fs.existsSync(path.join(filteredDestDir, '._MyApp.app'))).toBe(false);
    expect(fs.existsSync(path.join(filteredDestDir, 'MyApp.app', 'PlugIns', '._Ext.appex'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(filteredDestDir, '__MACOSX'))).toBe(false);

    await decompressTarAsync({
      archivePath,
      destinationDirectory: unfilteredDestDir,
    });

    expect(fs.existsSync(path.join(unfilteredDestDir, '._MyApp.app'))).toBe(true);
    expect(fs.existsSync(path.join(unfilteredDestDir, '__MACOSX', 'MyApp.app', '._MyApp'))).toBe(
      true
    );
  });
});
