import { formatBytes } from '../formatBytes';

describe(formatBytes, () => {
  const KB = 1024;
  const MB = 1024 * KB;
  const GB = 1024 * MB;

  it.each([
    [0, '0'],
    [1, '1 B'],
    [512.7, '512 B'],
    [1023, '1023 B'],
    [KB, '1.0 KB'],
    [1.5 * KB, '1.5 KB'],
    [102.4 * KB, '102 KB'],
    [500 * KB, '500 KB'],
    [MB - 1, '1023 KB'],
    [MB, '1.0 MB'],
    [20 * MB, '20.0 MB'],
    [102.4 * MB, '102 MB'],
    [500 * MB, '500 MB'],
    [GB - 1, '1023 MB'],
    [GB, '1.0 GB'],
    [1.5 * GB, '1.5 GB'],
    [102.4 * GB, '102 GB'],
    [200 * GB, '200 GB'],
    [2048 * GB, '2048 GB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
