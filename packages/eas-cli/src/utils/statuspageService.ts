import chalk from 'chalk';

import {
  StatuspageServiceFragment,
  StatuspageServiceName,
  StatuspageServiceStatus,
} from '../graphql/generated';
import { StatuspageServiceQuery } from '../graphql/queries/StatuspageServiceQuery';
import Log, { link } from '../log';

export async function maybeWarnAboutEasOutagesAsync(
  serviceNames: StatuspageServiceName[]
): Promise<void> {
  const services = await getStatuspageServiceAsync(serviceNames);

  for (const service of services) {
    warnAboutServiceOutage(service);
  }
}

const humanReadableServiceName: Record<StatuspageServiceName, string> = {
  [StatuspageServiceName.EasBuild]: 'EAS Build',
  [StatuspageServiceName.EasSubmit]: 'EAS Submit',
  [StatuspageServiceName.EasUpdate]: 'EAS Update',
};

function warnAboutServiceOutage(service: StatuspageServiceFragment): void {
  if (service.status !== StatuspageServiceStatus.Operational) {
    const outageType = service.status === StatuspageServiceStatus.MajorOutage ? 'major' : 'partial';

    Log.warn(
      `Service status warning: ${chalk.bold(
        humanReadableServiceName[service.name]
      )} is experiencing a ${outageType} outage. The service may temporarily not function as expected.`
    );

    if (service.incidents.length > 0) {
      const [currentIncident] = service.incidents;
      Log.warn(`Reason: ${currentIncident.name}`);
    }

    Log.warn(
      `All information on service status and incidents available at ${link(
        'https://status.expo.dev/'
      )}.`
    );
    Log.newLine();
  }
}

async function getStatuspageServiceAsync(
  serviceNames: StatuspageServiceName[]
): Promise<StatuspageServiceFragment[]> {
  try {
    return await StatuspageServiceQuery.statuspageServicesAsync(serviceNames);
  } catch {
    return [];
  }
}
