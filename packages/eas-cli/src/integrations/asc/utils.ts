import { CombinedError } from '@urql/core';
import chalk from 'chalk';

import { AscAppLinkQuery } from '../../graphql/queries/AscAppLinkQuery';

type AscAppLinkMetadata = Awaited<ReturnType<typeof AscAppLinkQuery.getAppMetadataAsync>>;

export type AscAppLinkStatus = 'not-connected' | 'connected' | 'invalid';

export interface AscAppLinkJsonOutput {
  action: string;
  project: string;
  status: AscAppLinkStatus;
  appStoreConnectApp: {
    id: string;
    ascAppIdentifier: string;
    name: string | null;
    bundleIdentifier: string | null;
    appleUrl: string;
  } | null;
}

export function buildJsonOutput(
  action: string,
  metadata: AscAppLinkMetadata
): AscAppLinkJsonOutput {
  const link = metadata.appStoreConnectApp;
  return {
    action,
    project: metadata.fullName,
    status: link ? 'connected' : 'not-connected',
    appStoreConnectApp: link
      ? {
          id: link.id,
          ascAppIdentifier: link.ascAppIdentifier,
          name: link.remoteAppStoreConnectApp.name ?? null,
          bundleIdentifier: link.remoteAppStoreConnectApp.bundleIdentifier ?? null,
          appleUrl: getAppleAppUrl(link.ascAppIdentifier),
        }
      : null,
  };
}

export function buildInvalidJsonOutput(action: string, projectId: string): AscAppLinkJsonOutput {
  return {
    action,
    project: projectId,
    status: 'invalid',
    appStoreConnectApp: null,
  };
}

export function isAscAuthenticationError(error: unknown): error is CombinedError {
  return (
    error instanceof CombinedError &&
    error.graphQLErrors.some(e => e.message.includes('App Store Connect rejected this API key'))
  );
}

export function formatAscAppLinkStatus(metadata: AscAppLinkMetadata): string {
  const link = metadata.appStoreConnectApp;
  if (!link) {
    return `Project ${chalk.bold(metadata.fullName)}: ${chalk.yellow('Not connected')} to App Store Connect.`;
  }

  const lines: string[] = [
    `Project ${chalk.bold(metadata.fullName)}: ${chalk.green('Connected')} to App Store Connect.`,
    `  ASC App ID:  ${chalk.bold(link.ascAppIdentifier)}`,
  ];

  const remote = link.remoteAppStoreConnectApp;
  lines.push(`  Name:        ${remote.name}`);
  lines.push(`  Bundle ID:   ${remote.bundleIdentifier}`);
  lines.push(`  Apple URL:   ${getAppleAppUrl(link.ascAppIdentifier)}`);

  return lines.join('\n');
}

function getAppleAppUrl(ascAppIdentifier: string): string {
  return `https://appstoreconnect.apple.com/apps/${encodeURIComponent(ascAppIdentifier)}/distribution`;
}
