import {
  StatuspageServiceFragment,
  StatuspageServiceName,
  StatuspageServiceStatus,
} from '../graphql/generated';
import { StatuspageServiceQuery } from '../graphql/queries/StatuspageServiceQuery';
import Log from '../log';

export async function maybeWarnAboutEasOutagesAsync(
  serviceNames: StatuspageServiceName[]
): Promise<void> {
  const services = await getStatuspageServiceAsync(serviceNames);

  for (const service of services) {
    warnAboutServiceOutage(service);
  }
}

function warnAboutServiceOutage(service: StatuspageServiceFragment): void {
  const humanReadableServiceName: Record<StatuspageServiceName, string> = {
    [StatuspageServiceName.EasBuild]: 'EAS Build',
    [StatuspageServiceName.EasSubmit]: 'EAS Submit',
    [StatuspageServiceName.EasUpdate]: 'EAS Update',
  };

  if (service.status !== StatuspageServiceStatus.Operational) {
    Log.warn(
      `⚠️  ${
        humanReadableServiceName[service.name]
      } is currently in a degraded state. The service may temporarily not function as expected.`
    );

    if (service.incidents.length > 0) {
      const [currentIncident] = service.incidents;
      Log.warn(`Reason: ${currentIncident.name}`);
    }

    Log.warn('Check https://status.expo.dev/ for more information.');
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
