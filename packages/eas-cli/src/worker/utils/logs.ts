import chalk from 'chalk';

import type {
  WorkerDeploymentAliasFragment,
  WorkerDeploymentFragment,
} from '../../graphql/generated';
import formatFields, { type FormatFieldsItem } from '../../utils/formatFields';

export const EXPO_BASE_DOMAIN = process.env.EXPO_STAGING ? 'staging.expo' : 'expo';

export function getDeploymentUrlFromFullName(deploymentFullName: string): string {
  return `https://${deploymentFullName}.${EXPO_BASE_DOMAIN}.app`;
}

export function getDashboardUrl(projectId: string): string {
  return `https://${EXPO_BASE_DOMAIN}.dev/projects/${projectId}/hosting/deployments`;
}

type WorkerDeploymentData = {
  /** Used to generate the dashboard URL to `expo.dev` */
  projectId: string;
  /** The actual deployment information */
  deployment: Pick<WorkerDeploymentFragment, 'deploymentIdentifier' | 'url'>;
  /** All modified aliases of the deployment, if any */
  alias?: WorkerDeploymentAliasFragment | null;
  /** The production promoting alias of the deployment, if any */
  production?: WorkerDeploymentAliasFragment | null;
};

export function formatWorkerDeploymentTable(data: WorkerDeploymentData): string {
  const fields: FormatFieldsItem[] = [
    { label: 'Dashboard', value: getDashboardUrl(data.projectId) },
    { label: 'Deployment URL', value: data.deployment.url },
  ];

  if (data.alias) {
    fields.push({ label: 'Alias URL', value: data.alias.url });
  }
  if (data.production) {
    fields.push({ label: 'Production URL', value: data.production.url });
  }

  const lastUrlField = fields[fields.length - 1];
  lastUrlField.value = chalk.cyan(lastUrlField.value);

  return formatFields(fields);
}

type WorkerDeploymentOutput = {
  /** The absolute URL to the dashboard on `expo.dev` */
  dashboardUrl: string;
  /** The deployment identifier */
  identifier: string;
  /** The deployment URL */
  url: string;
  /** A custom alias, if assigned */
  alias?: { id: string; url: string };
  /** The production alias, if assigned */
  production?: { id: string; url: string };
};

export function formatWorkerDeploymentJson(data: WorkerDeploymentData): WorkerDeploymentOutput {
  return {
    dashboardUrl: getDashboardUrl(data.projectId),
    identifier: data.deployment.deploymentIdentifier,
    url: data.deployment.url,
    alias: data.alias || undefined,
    production: data.production || undefined,
  };
}
