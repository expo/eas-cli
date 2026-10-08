import type { ComprehensiveRelease, Release, VersionType } from '@changesets/types';

export interface RootEntry {
  bumpType: VersionType;
  text: string;
}

const CATEGORY_HEADINGS: readonly (readonly [VersionType, string])[] = [
  ['major', '🛠 Breaking changes'],
  ['minor', '🎉 New features'],
  ['patch', '🐛 Bug fixes'],
  ['none', '🧹 Chores'],
];

const BUMP_ORDER: readonly VersionType[] = ['none', 'patch', 'minor', 'major'];

export function getSharedVersion(releases: readonly ComprehensiveRelease[]): string {
  const versions = new Set(
    releases.filter(release => release.type !== 'none').map(release => release.newVersion)
  );
  if (versions.size === 0) {
    throw new Error(
      'The changesets release no package: all of them are empty or "none". Add a changeset with a patch, minor, or major bump.'
    );
  }
  const [version] = versions;
  if (versions.size > 1 || !version) {
    throw new Error(
      `All packages must share one version, but the release plan has: ${[...versions].join(', ')}. Check "fixed" in .changeset/config.json.`
    );
  }
  return version;
}

export function getHighestBumpType(releases: readonly Release[]): VersionType {
  let highest: VersionType = 'none';
  for (const release of releases) {
    if (BUMP_ORDER.indexOf(release.type) > BUMP_ORDER.indexOf(highest)) {
      highest = release.type;
    }
  }
  return highest;
}

export function formatPackagePrefix(
  releases: readonly Release[],
  dirByPackageName: ReadonlyMap<string, string>
): string {
  return releases
    .map(release => {
      const dir = dirByPackageName.get(release.name);
      if (!dir) {
        throw new Error(`Package "${release.name}" from a changeset is not in packages/.`);
      }
      return `[${dir}]`;
    })
    .join('');
}

export function renderRootSection(version: string, date: string, entries: RootEntry[]): string {
  const lines = [
    `## [${version}](https://github.com/expo/eas-cli/releases/tag/v${version}) - ${date}`,
  ];
  for (const [bumpType, heading] of CATEGORY_HEADINGS) {
    const categoryEntries = entries.filter(entry => entry.bumpType === bumpType);
    if (categoryEntries.length === 0) {
      continue;
    }
    lines.push('', `### ${heading}`, '');
    for (const entry of categoryEntries) {
      lines.push(`- ${entry.text}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function insertRootSection(changelog: string, section: string): string {
  const firstReleaseIndex = changelog.search(/^## /m);
  if (firstReleaseIndex === -1) {
    return `${changelog.trimEnd()}\n\n${section}`;
  }
  return `${changelog.slice(0, firstReleaseIndex)}${section}\n${changelog.slice(firstReleaseIndex)}`;
}
