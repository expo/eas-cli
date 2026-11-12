import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  StatuspageServiceFragment,
  StatuspageServiceName,
  StatuspageServiceStatus,
} from '../graphql/generated';
import { StatuspageServiceQuery } from '../graphql/queries/StatuspageServiceQuery';
import Log, { link } from '../log';

export async function maybeWarnAboutEasOutagesAsync(
  graphqlClient: ExpoGraphqlClient,
  serviceNames: StatuspageServiceName[]
): Promise<void> {
  const services = await getStatuspageServiceAsync(graphqlClient, serviceNames);

  for (const service of services) {
    warnAboutServiceOutage(service);
  }
}

const humanReadableServiceName: Record<StatuspageServiceName, string> = {
  [StatuspageServiceName.EasBuild]: 'EAS Build',
  [StatuspageServiceName.EasSubmit]: 'EAS Submit',
  [StatuspageServiceName.EasUpdate]: 'EAS Update',
  [StatuspageServiceName.GithubApiRequests]: 'GitHub API Requests',
  [StatuspageServiceName.GithubWebhooks]: 'Github Webhooks',
  [StatuspageServiceName.EasWorkflows]: 'EAS Workflows',
  [StatuspageServiceName.EasSimulator]: 'EAS Simulator',
};

const statusDescription: Record<StatuspageServiceStatus, string> = {
  [StatuspageServiceStatus.MajorOutage]: 'is experiencing a major outage',
  [StatuspageServiceStatus.PartialOutage]: 'is experiencing a partial outage',
  [StatuspageServiceStatus.DegradedPerformance]: 'is experiencing degraded performance',
  [StatuspageServiceStatus.UnderMaintenance]: 'is under maintenance',
  [StatuspageServiceStatus.Operational]: 'is operational',
};

function warnAboutServiceOutage(service: StatuspageServiceFragment): void {
  if (service.status === StatuspageServiceStatus.Operational) {
    return;
  }

  // An older CLI can receive a status that was added to the API later.
  const description = statusDescription[service.status] ?? 'is experiencing issues';

  Log.addNewLineIfNone();
  Log.warn(chalk.bold(`${humanReadableServiceName[service.name]} ${description}.`));

  if (service.incidents.length > 0) {
    const [currentIncident] = service.incidents;
    Log.warn(`Reason: ${currentIncident.name}.`);
  }

  Log.warn(
    `All information on service status and incidents available at ${link(
      'https://status.expo.dev/'
    )}`
  );
  Log.newLine();
}

async function getStatuspageServiceAsync(
  graphqlClient: ExpoGraphqlClient,
  serviceNames: StatuspageServiceName[]
): Promise<StatuspageServiceFragment[]> {
  try {
    return await StatuspageServiceQuery.statuspageServicesAsync(graphqlClient, serviceNames);
  } catch {
    return [];
  }
}
