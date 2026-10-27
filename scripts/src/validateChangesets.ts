/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ROOT_DIR, readPackageDirsByNameAsync } from './changesets/packages.js';
import { hasChangelogContentChanges, validateChangeset } from './changesets/validation.js';

const CHANGESET_FILE = /^\.changeset\/[^/]+\.md$/;

function getChangedFiles(baseRef: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=d', `${baseRef}...HEAD`],
    { cwd: ROOT_DIR, encoding: 'utf8' }
  );
  return output.split('\n').filter(Boolean);
}

async function mainAsync(): Promise<void> {
  const baseRef = process.argv[2];
  if (!baseRef) {
    throw new Error('Usage: validate-changesets <base-ref> [--allow-no-changeset]');
  }
  const changedFiles = getChangedFiles(baseRef);
  const errors: string[] = changedFiles
    .filter(file => path.basename(file) === 'CHANGELOG.md')
    .filter(file => hasChangelogContentChanges(baseRef, file, ROOT_DIR))
    .map(
      file =>
        `${file}: do not edit generated changelog text. Only blank-line repairs are allowed. Run \`yarn changeset\` instead.`
    );

  const changesetFiles = changedFiles.filter(
    file => CHANGESET_FILE.test(file) && file !== '.changeset/README.md'
  );
  if (changesetFiles.length === 0 && !process.argv.includes('--allow-no-changeset')) {
    errors.push('This PR has no changeset. Run `yarn changeset` and commit the new file.');
  }

  const packageNames = new Set((await readPackageDirsByNameAsync()).keys());
  for (const file of changesetFiles) {
    errors.push(
      ...validateChangeset(file, await readFile(path.join(ROOT_DIR, file), 'utf8'), packageNames)
    );
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`❌ ${error}`);
    }
    process.exit(1);
  }
  console.log(`✅ Found ${changesetFiles.length} valid changeset(s): ${changesetFiles.join(', ')}`);
}

mainAsync().catch(error => {
  console.error(error);
  process.exit(1);
});
