import type { ComprehensiveRelease } from '@changesets/types';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatPackagePrefix,
  getHighestBumpType,
  getSharedVersion,
  insertRootSection,
  renderRootSection,
} from './rootChangelog.js';

function release(
  name: string,
  type: ComprehensiveRelease['type'],
  newVersion: string
): ComprehensiveRelease {
  return { name, type, newVersion, oldVersion: '1.0.0', changesets: [] } as ComprehensiveRelease;
}

describe(getSharedVersion.name, () => {
  it('returns the one version of the released packages', () => {
    assert.equal(
      getSharedVersion([release('a', 'minor', '1.1.0'), release('b', 'minor', '1.1.0')]),
      '1.1.0'
    );
  });

  it('ignores packages that are not released', () => {
    assert.equal(
      getSharedVersion([release('a', 'patch', '1.0.1'), release('b', 'none', '1.0.0')]),
      '1.0.1'
    );
  });

  it('throws when no package is released', () => {
    assert.throws(() => getSharedVersion([release('a', 'none', '1.0.0')]), /release no package/);
    assert.throws(() => getSharedVersion([]), /release no package/);
  });

  it('throws when the released packages have different versions', () => {
    assert.throws(
      () => getSharedVersion([release('a', 'minor', '1.1.0'), release('b', 'patch', '1.0.1')]),
      /share one version.*1\.1\.0, 1\.0\.1/
    );
  });
});

describe(getHighestBumpType.name, () => {
  it('returns the highest bump', () => {
    assert.equal(
      getHighestBumpType([
        { name: 'a', type: 'patch' },
        { name: 'b', type: 'major' },
        { name: 'c', type: 'minor' },
      ]),
      'major'
    );
  });

  it('returns none for an empty changeset', () => {
    assert.equal(getHighestBumpType([]), 'none');
  });
});

describe(formatPackagePrefix.name, () => {
  const dirs = new Map([
    ['eas-cli', 'eas-cli'],
    ['@expo/build-tools', 'build-tools'],
  ]);

  it('lists the package directories in changeset order', () => {
    assert.equal(
      formatPackagePrefix(
        [
          { name: 'eas-cli', type: 'minor' },
          { name: '@expo/build-tools', type: 'patch' },
        ],
        dirs
      ),
      '[eas-cli][build-tools]'
    );
  });

  it('returns an empty string for an empty changeset', () => {
    assert.equal(formatPackagePrefix([], dirs), '');
  });

  it('throws on an unknown package', () => {
    assert.throws(
      () => formatPackagePrefix([{ name: 'nope', type: 'patch' }], dirs),
      /"nope" from a changeset is not in packages/
    );
  });
});

describe(renderRootSection.name, () => {
  it('groups entries by category in a fixed order and skips empty categories', () => {
    assert.equal(
      renderRootSection('2.0.0', '2026-10-08', [
        { bumpType: 'none', text: 'Chore.' },
        { bumpType: 'patch', text: 'Fix.' },
        { bumpType: 'major', text: 'Break.' },
        { bumpType: 'patch', text: 'Fix 2.' },
      ]),
      [
        '## [2.0.0](https://github.com/expo/eas-cli/releases/tag/v2.0.0) - 2026-10-08',
        '',
        '### 🛠 Breaking changes',
        '',
        '- Break.',
        '',
        '### 🐛 Bug fixes',
        '',
        '- Fix.',
        '- Fix 2.',
        '',
        '### 🧹 Chores',
        '',
        '- Chore.',
        '',
      ].join('\n')
    );
  });
});

describe(insertRootSection.name, () => {
  const section = '## [2.0.0](url) - 2026-10-08\n\n### 🐛 Bug fixes\n\n- Fix.\n';

  it('inserts the section above the newest release', () => {
    const changelog = '# Changelog\n\nIntro.\n\n## [1.0.0](url) - 2026-01-01\n\n- Old.\n';
    assert.equal(
      insertRootSection(changelog, section),
      `# Changelog\n\nIntro.\n\n${section}\n## [1.0.0](url) - 2026-01-01\n\n- Old.\n`
    );
  });

  it('appends the section when there is no release yet', () => {
    assert.equal(
      insertRootSection('# Changelog\n\nIntro.\n', section),
      `# Changelog\n\nIntro.\n\n${section}`
    );
  });
});
