import { StatuspageServiceName, StatuspageServiceStatus } from '../graphql/generated';
import { StatuspageServiceQuery } from '../graphql/queries/StatuspageServiceQuery';
import Log from '../log';

export async function warnIfStatuspageServiceIsntOperationalAsync(
  serviceName: StatuspageServiceName
): Promise<boolean> {
  const service = await StatuspageServiceQuery.statuspageServicesAsync(serviceName);

  const humanReadableServiceName: Record<StatuspageServiceName, string> = {
    [StatuspageServiceName.EasBuild]: 'EAS Build',
    [StatuspageServiceName.EasSubmit]: 'EAS Submit',
    [StatuspageServiceName.EasUpdate]: 'EAS Update',
  };

  if (service && service.status !== StatuspageServiceStatus.Operational) {
    Log.warn(
      `⚠️  ${humanReadableServiceName[serviceName]} is currently in a degraded state. The service may temporarily not function as expected.`
    );

    if (service.incidents.length > 0) {
      const [latestIncident] = service.incidents;
      Log.warn(`Reason: ${latestIncident.name}`);
    }

    Log.warn('Please check https://status.expo.dev/ for more information.');

    return true;
  }
  return false;
}
