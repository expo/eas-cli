import chalk from 'chalk';

import {
  AppObserveAppBuildNumber,
  AppObserveAppEasBuild,
  AppObserveAppUpdate,
} from '../graphql/generated';
import { appPlatformDisplayNames } from '../platform';
import { AppVersionsResult } from './fetchVersions';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export interface AppVersionJson {
  platform: string;
  appVersion: string;
  firstSeenAt: string;
  eventCount: number;
  uniqueUserCount: number;
  buildNumbers: AppBuildNumberJson[];
  updates: AppUpdateJson[];
}

export interface AppBuildNumberJson {
  appBuildNumber: string;
  firstSeenAt: string;
  eventCount: number;
  uniqueUserCount: number;
  easBuilds: AppEasBuildJson[];
}

export interface AppUpdateJson {
  appUpdateId: string;
  firstSeenAt: string;
  eventCount: number;
  uniqueUserCount: number;
  easBuilds: AppEasBuildJson[];
}

export interface AppEasBuildJson {
  easBuildId: string;
  firstSeenAt: string;
  eventCount: number;
  uniqueUserCount: number;
}

function mapEasBuilds(easBuilds: AppObserveAppEasBuild[]): AppEasBuildJson[] {
  return easBuilds.map(b => ({
    easBuildId: b.easBuildId,
    firstSeenAt: b.firstSeenAt,
    eventCount: b.eventCount,
    uniqueUserCount: b.uniqueUserCount,
  }));
}

function mapBuildNumbers(buildNumbers: AppObserveAppBuildNumber[]): AppBuildNumberJson[] {
  return buildNumbers.map(bn => ({
    appBuildNumber: bn.appBuildNumber,
    firstSeenAt: bn.firstSeenAt,
    eventCount: bn.eventCount,
    uniqueUserCount: bn.uniqueUserCount,
    easBuilds: mapEasBuilds(bn.easBuilds),
  }));
}

function mapUpdates(updates: AppObserveAppUpdate[]): AppUpdateJson[] {
  return updates.map(u => ({
    appUpdateId: u.appUpdateId,
    firstSeenAt: u.firstSeenAt,
    eventCount: u.eventCount,
    uniqueUserCount: u.uniqueUserCount,
    easBuilds: mapEasBuilds(u.easBuilds),
  }));
}

export function buildObserveVersionsJson(results: AppVersionsResult[]): AppVersionJson[] {
  const output: AppVersionJson[] = [];
  for (const { platform, appVersions } of results) {
    for (const v of appVersions) {
      output.push({
        platform: platform as string,
        appVersion: v.appVersion,
        firstSeenAt: v.firstSeenAt,
        eventCount: v.eventCount,
        uniqueUserCount: v.uniqueUserCount,
        buildNumbers: mapBuildNumbers(v.buildNumbers),
        updates: mapUpdates(v.updates),
      });
    }
  }
  return output;
}

function renderTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row => row.map((cell, i) => cell.padEnd(colWidths[i])).join('  '));
  return [chalk.bold(headerLine), separatorLine, ...dataLines].join('\n');
}

export function buildObserveVersionsTable(results: AppVersionsResult[]): string {
  const hasAnyVersions = results.some(r => r.appVersions.length > 0);

  if (!hasAnyVersions) {
    return chalk.yellow('No app versions found.');
  }

  const headers = ['App Version', 'First Seen', 'Events', 'Users', 'Builds', 'Updates'];

  const sections: string[] = [];

  for (const { platform, appVersions } of results) {
    if (appVersions.length === 0) {
      continue;
    }

    if (sections.length > 0) {
      sections.push('');
    }
    sections.push(chalk.bold(appPlatformDisplayNames[platform]));

    const rows: string[][] = appVersions.map(version => [
      version.appVersion,
      formatDate(version.firstSeenAt),
      String(version.eventCount),
      String(version.uniqueUserCount),
      String(version.buildNumbers.length),
      String(version.updates.length),
    ]);

    sections.push(renderTable(headers, rows));
  }

  return sections.join('\n');
}
