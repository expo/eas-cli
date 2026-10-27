import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';

import { validateChangesetAsync } from '../validateChangesets.js';
import { ROOT_DIR } from './packages.js';

it('requires one nonempty summary line while allowing surrounding whitespace', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'changeset-summary-'));
  const file = path.relative(ROOT_DIR, path.join(dir, 'summary.md'));
  try {
    for (const [summary, valid] of [
      ['Fix a bug.', true],
      ['\nFix a bug.\r\n\n', true],
      ['', false],
      ['Fix a bug.\nDetails.', false],
      ['Fix a bug.\n\nDetails.', false],
      ['Fix a bug.\r\nDetails.', false],
    ] as const) {
      await writeFile(path.join(ROOT_DIR, file), `---\n'eas-cli': patch\n---\n\n${summary}`);
      const errors = await validateChangesetAsync(file, new Set(['eas-cli']));
      if (valid) {
        assert.deepEqual(errors, []);
      } else {
        assert.equal(errors.length, 1);
        assert.match(errors[0], summary ? /exactly one nonempty line/ : /summary is empty/);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
