import { vol } from 'memfs';

import { decompressTarAsync, isFileTarGzAsync } from '../files';

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
});
