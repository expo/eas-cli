/* eslint-disable no-console */

import { parseChangesetFile } from '@changesets/parse';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ROOT_DIR, readPackageDirsByNameAsync } from './changesets/packages.js';

const CHANGESET_FILE = /^\.changeset\/[^/]+\.md$/;

function getChangedFiles(baseRef: string): string[] {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=d', `${baseRef}...HEAD`],
    { cwd: ROOT_DIR, encoding: 'utf8' }
  );
  return output.split('\n').filter(Boolean);
}

async function validateChangesetAsync(
  file: string,
  packageNames: ReadonlySet<string>
): Promise<string[]> {
  let changeset: ReturnType<typeof parseChangesetFile>;
  try {
    changeset = parseChangesetFile(await readFile(path.join(ROOT_DIR, file), 'utf8'));
  } catch (error) {
    return [`${file}: cannot parse the changeset. ${(error as Error).message}`];
  }
  const errors: string[] = [];
  if (!changeset.summary.trim()) {
    errors.push(`${file}: the summary is empty. Describe the change below the front matter.`);
  }
  for (const release of changeset.releases) {
    if (!packageNames.has(release.name)) {
      errors.push(`${file}: "${release.name}" is not a package in packages/.`);
    }
  }
  return errors;
}

async function mainAsync(): Promise<void> {
  const baseRef = process.argv[2];
  if (!baseRef) {
    throw new Error('Usage: validate-changesets <base-ref>');
  }
  const changedFiles = getChangedFiles(baseRef);
  const errors: string[] = changedFiles
    .filter(file => path.basename(file) === 'CHANGELOG.md')
    .map(
      file =>
        `${file}: do not edit CHANGELOG.md files. The release generates them from changesets. Run \`yarn changeset\` instead.`
    );

  const changesetFiles = changedFiles.filter(
    file => CHANGESET_FILE.test(file) && file !== '.changeset/README.md'
  );
  if (changesetFiles.length === 0) {
    errors.push('This PR has no changeset. Run `yarn changeset` and commit the new file.');
  }

  const packageNames = new Set((await readPackageDirsByNameAsync()).keys());
  for (const file of changesetFiles) {
    errors.push(...(await validateChangesetAsync(file, packageNames)));
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
