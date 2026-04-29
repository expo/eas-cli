import chalk from 'chalk';

import { ConvexProjectData, ConvexTeamConnectionData } from '../graphql/types/ConvexTeamConnection';
import Log, { link } from '../log';
import { confirmAsync } from '../prompts';

const CONVEX_DASHBOARD_HOST = 'https://dashboard.convex.dev';
const RECENT_INVITE_THRESHOLD_MS = 60 * 60 * 1000;

export function getConvexTeamDashboardUrl(connection: ConvexTeamConnectionData): string {
  return `${CONVEX_DASHBOARD_HOST}/t/${encodeURIComponent(connection.convexTeamSlug)}`;
}

export function getConvexProjectDashboardUrl(project: ConvexProjectData): string {
  return `${getConvexTeamDashboardUrl(project.convexTeamConnection)}/${encodeURIComponent(
    project.convexProjectSlug
  )}`;
}

export function formatConvexTeam(connection: ConvexTeamConnectionData): string {
  return `${connection.convexTeamName} / ${connection.convexTeamSlug}`;
}

export function formatConvexTeamConnection(connection: ConvexTeamConnectionData): string {
  const lines = [
    `${chalk.bold('Team')}: ${formatConvexTeam(connection)}`,
    `${chalk.bold('Dashboard')}: ${link(getConvexTeamDashboardUrl(connection), { dim: false })}`,
  ];

  if (connection.invitedEmail) {
    lines.push(`${chalk.bold('Invited email')}: ${connection.invitedEmail}`);
  }
  if (connection.invitedAt) {
    lines.push(`${chalk.bold('Invited at')}: ${connection.invitedAt}`);
  }

  return lines.join('\n');
}

export function formatConvexProject(project: ConvexProjectData): string {
  return [
    `${chalk.bold('Name')}: ${project.convexProjectName}`,
    `${chalk.bold('Slug')}: ${project.convexProjectSlug}`,
    `${chalk.bold('Identifier')}: ${project.convexProjectIdentifier}`,
    `${chalk.bold('Team')}: ${formatConvexTeam(project.convexTeamConnection)}`,
    `${chalk.bold('Dashboard')}: ${link(getConvexProjectDashboardUrl(project), { dim: false })}`,
  ].join('\n');
}

export function logNoConvexTeams(accountName: string): void {
  Log.warn(`No Convex team is linked to account ${chalk.bold(accountName)} on EAS.`);
}

export function logNoConvexProject(projectName: string): void {
  Log.warn(`No Convex project is linked to Expo app ${chalk.bold(projectName)} on EAS.`);
}

export async function confirmRecentConvexInviteAsync(
  connection: ConvexTeamConnectionData,
  { nonInteractive }: { nonInteractive: boolean }
): Promise<boolean> {
  const invitedAt = connection.invitedAt ? new Date(connection.invitedAt) : null;
  if (!invitedAt || Number.isNaN(invitedAt.getTime())) {
    return true;
  }

  const timeSinceInviteMs = Date.now() - invitedAt.getTime();
  if (timeSinceInviteMs >= RECENT_INVITE_THRESHOLD_MS) {
    return true;
  }

  const previousInvite = `A Convex team invite was already sent${connection.invitedEmail ? ` to ${connection.invitedEmail}` : ''} at ${connection.invitedAt}.`;
  if (nonInteractive) {
    Log.warn(
      `${previousInvite} Sending another invite because this command is running in non-interactive mode.`
    );
    return true;
  }

  return await confirmAsync({
    message: `${previousInvite} Are you sure you want to send another invite?`,
  });
}
