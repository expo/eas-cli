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
};

function warnAboutServiceOutage(service: StatuspageServiceFragment): void {
  if (service.status === StatuspageServiceStatus.Operational) {
    return;
  }

  const outageType = service.status === StatuspageServiceStatus.MajorOutage ? 'major' : 'partial';

  Log.addNewLineIfNone();
  Log.warn(
    chalk.bold(`${humanReadableServiceName[service.name]} is experiencing a ${outageType} outage.`)
  );

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
