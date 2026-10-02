import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CircularFile } from '../circularFile';

it.each([1, 7, 16])(
  'retains the latest %s bytes through multiple wraps and oversized chunks',
  async capacity => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'circular-file-test-'));
    try {
      const output = new CircularFile(path.join(directory, 'output.log'), capacity);
      let expected = Buffer.alloc(0);
      for (const length of [0, 1, capacity - 1, 2, capacity, capacity + 3, 1, 31]) {
        const chunk = Buffer.from(Array.from({ length }, (_, i) => (expected.length + i) % 256));
        expected = Buffer.concat([expected, chunk]);
        output.append(chunk);
        expect(output.read()).toEqual(expected.subarray(-capacity));
        expect(output.read(Math.min(capacity, 3))).toEqual(
          expected.subarray(-Math.min(capacity, 3))
        );
        expect((await stat(output.filePath)).size).toBeLessThanOrEqual(capacity);
        expect(output.truncated).toBe(expected.length > capacity);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
