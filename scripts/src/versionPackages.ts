/* eslint-disable no-console */

import { getReleasePlan } from '@changesets/get-release-plan';
import { getCommitsThatAddFiles } from '@changesets/git';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getAttributionAsync } from '../../.changeset/changelog.mjs';
import { formatEntry } from '../../.changeset/formatEntry.mjs';
import { ROOT_DIR, readPackageDirsByNameAsync } from './changesets/packages.js';
import {
  type RootEntry,
  formatPackagePrefix,
  getHighestBumpType,
  getSharedVersion,
  insertRootSection,
  renderRootSection,
} from './changesets/rootChangelog.js';

const ROOT_CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');
const LERNA_JSON_PATH = path.join(ROOT_DIR, 'lerna.json');

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: ROOT_DIR, encoding: 'utf8' });
}

function runWithOutput(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: ROOT_DIR, stdio: 'inherit' });
}

function isPublishingRun(): boolean {
  const userName = run('git', ['config', 'get', '--global', 'user.name']).trim();
  const userEmail = run('git', ['config', 'get', '--global', 'user.email']).trim();
  return (
    userName === 'Expo CI' &&
    userEmail === 'support+ci@expo.io' &&
    process.env.INPUT_DRY_RUN !== 'true'
  );
}

async function buildRootEntriesAsync(): Promise<{ version: string; entries: RootEntry[] }> {
  const releasePlan = await getReleasePlan(ROOT_DIR);
  if (releasePlan.changesets.length === 0) {
    throw new Error('There are no changesets in .changeset/. Nothing to release.');
  }
  const version = getSharedVersion(releasePlan.releases);
  const dirByPackageName = await readPackageDirsByNameAsync();
  const commits = await getCommitsThatAddFiles(
    releasePlan.changesets.map(changeset => `.changeset/${changeset.id}.md`),
    { cwd: ROOT_DIR }
  );
  const entries = await Promise.all(
    releasePlan.changesets.map(async (changeset, index) => {
      const attribution = await getAttributionAsync({ ...changeset, commit: commits[index] });
      const prefix = formatPackagePrefix(changeset.releases, dirByPackageName);
      const text = formatEntry(changeset.summary, attribution);
      return {
        bumpType: getHighestBumpType(changeset.releases),
        text: prefix ? `${prefix} ${text}` : text,
      };
    })
  );
  return { version, entries };
}

async function updateLernaVersionAsync(version: string): Promise<void> {
  const lernaJson = JSON.parse(await readFile(LERNA_JSON_PATH, 'utf8'));
  lernaJson.version = version;
  await writeFile(LERNA_JSON_PATH, `${JSON.stringify(lernaJson, null, 2)}\n`);
}

async function updateRootChangelogAsync(section: string): Promise<void> {
  const changelog = await readFile(ROOT_CHANGELOG_PATH, 'utf8');
  await writeFile(ROOT_CHANGELOG_PATH, insertRootSection(changelog, section));
}

async function mainAsync(): Promise<void> {
  const { version, entries } = await buildRootEntriesAsync();
  const date = new Date().toISOString().slice(0, 10);
  const section = renderRootSection(version, date, entries);

  runWithOutput('yarn', ['changeset', 'version']);
  await updateLernaVersionAsync(version);
  runWithOutput('yarn', ['install', '--mode=update-lockfile']);
  runWithOutput('yarn', ['workspace', 'eas-cli', 'run', 'version']);
  await updateRootChangelogAsync(section);

  const tag = `v${version}`;
  if (!isPublishingRun()) {
    console.log(`Dry run: ${tag} was not committed, tagged, or pushed.\n`);
    console.log(section);
    runWithOutput('git', ['status', '--short']);
    return;
  }
  runWithOutput('git', ['add', '--all']);
  runWithOutput('git', ['commit', '--message', tag]);
  runWithOutput('git', ['tag', '--annotate', tag, '--message', tag]);
  runWithOutput('git', ['push', '--atomic', '--no-verify', 'origin', 'main', tag]);
}

mainAsync().catch(error => {
  console.error(error);
  process.exit(1);
});
