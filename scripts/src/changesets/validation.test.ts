import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { hasChangelogContentChanges, validateChangeset } from './validation.js';

const FILE = '.changeset/example.md';
const PACKAGES = new Set(['eas-cli']);
const FRONT_MATTER = "---\n'eas-cli': patch\n---\n\n";

describe(validateChangeset.name, () => {
  for (const summary of ['Fix a bug.', '\n Fix a bug. \n\n', 'Fix a bug.\r\n']) {
    it(`accepts one line with surrounding whitespace: ${JSON.stringify(summary)}`, () => {
      assert.deepEqual(validateChangeset(FILE, FRONT_MATTER + summary, PACKAGES), []);
    });
  }

  for (const summary of [
    '',
    '  \n ',
    'Fix a bug.\nDetails.',
    'Fix a bug.\n\nDetails.',
    'Fix a bug.\r\nDetails.',
    'Fix a bug.\n- Another change.',
  ]) {
    it(`rejects an empty or multiline body: ${JSON.stringify(summary)}`, () => {
      assert.deepEqual(validateChangeset(FILE, FRONT_MATTER + summary, PACKAGES), [
        `${FILE}: The changeset body must contain exactly one nonempty line. Combine the summary into one line below the front matter.`,
      ]);
    });
  }

  it('accepts a full CRLF changeset', () => {
    assert.deepEqual(
      validateChangeset(FILE, `${FRONT_MATTER}Fix a bug.\n`.replace(/\n/g, '\r\n'), PACKAGES),
      []
    );
  });

  it('still rejects unknown packages', () => {
    assert.match(
      validateChangeset(FILE, FRONT_MATTER + 'Fix a bug.', new Set())[0],
      /not a package/
    );
  });

  it('still rejects invalid front matter', () => {
    assert.match(
      validateChangeset(FILE, '---\ninvalid: [\n---\nFix a bug.', PACKAGES)[0],
      /cannot parse/
    );
  });
});

describe(hasChangelogContentChanges.name, () => {
  for (const [name, contents, expected] of [
    ['blank-line repair', '# Changelog\n\n- Fix.\n\n- Another fix.\n', false],
    ['text edit', '# Changelog\n\n- Different fix.\n- Another fix.\n', true],
    [
      'text edit with blank-line repair',
      '# Changelog\n\n- Different fix.\n\n- Another fix.\n',
      true,
    ],
  ] as const) {
    it(name, () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), 'changeset-validation-'));
      const git = (...args: string[]): string =>
        execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        git('init');
        git('config', 'user.name', 'Test');
        git('config', 'user.email', 'test@example.com');
        const file = path.join(cwd, 'CHANGELOG.md');
        writeFileSync(file, '# Changelog\n\n- Fix.\n- Another fix.\n');
        git('add', '.');
        git('commit', '-m', 'Base', '--no-verify');
        const base = git('rev-parse', 'HEAD').trim();
        writeFileSync(file, contents);
        git('add', '.');
        git('commit', '-m', 'Change', '--no-verify');
        assert.equal(hasChangelogContentChanges(base, 'CHANGELOG.md', cwd), expected);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});
