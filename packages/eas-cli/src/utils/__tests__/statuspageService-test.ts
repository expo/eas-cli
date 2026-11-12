import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  StatuspageIncidentImpact,
  StatuspageIncidentStatus,
  StatuspageServiceFragment,
  StatuspageServiceName,
  StatuspageServiceStatus,
} from '../../graphql/generated';
import { StatuspageServiceQuery } from '../../graphql/queries/StatuspageServiceQuery';
import Log from '../../log';
import { maybeWarnAboutEasOutagesAsync } from '../statuspageService';

jest.mock('../../graphql/queries/StatuspageServiceQuery');
jest.mock('../../log');

const graphqlClient = {} as ExpoGraphqlClient;

function makeService(
  name: StatuspageServiceName,
  status: StatuspageServiceStatus,
  incidentName?: string
): StatuspageServiceFragment {
  return {
    id: `${name}-id`,
    name,
    status,
    incidents: incidentName
      ? [
          {
            id: 'incident-id',
            name: incidentName,
            status: StatuspageIncidentStatus.Investigating,
            impact: StatuspageIncidentImpact.Major,
            shortlink: 'https://stspg.io/incident',
          },
        ]
      : [],
  };
}

function getWarnings(): string[] {
  return jest.mocked(Log.warn).mock.calls.map(([message]) => String(message));
}

describe(maybeWarnAboutEasOutagesAsync, () => {
  beforeEach(() => {
    jest.mocked(Log.warn).mockClear();
  });

  it('warns about an EAS Simulator outage with the incident name', async () => {
    jest
      .mocked(StatuspageServiceQuery.statuspageServicesAsync)
      .mockResolvedValue([
        makeService(
          StatuspageServiceName.EasSimulator,
          StatuspageServiceStatus.PartialOutage,
          'iOS simulator sessions fail to start'
        ),
      ]);

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasSimulator]);

    expect(StatuspageServiceQuery.statuspageServicesAsync).toHaveBeenCalledWith(graphqlClient, [
      StatuspageServiceName.EasSimulator,
    ]);
    const warnings = getWarnings();
    expect(warnings[0]).toContain('EAS Simulator is experiencing a partial outage.');
    expect(warnings[1]).toBe('Reason: iOS simulator sessions fail to start.');
  });

  it.each([
    [StatuspageServiceStatus.MajorOutage, 'EAS Workflows is experiencing a major outage.'],
    [
      StatuspageServiceStatus.DegradedPerformance,
      'EAS Workflows is experiencing degraded performance.',
    ],
    [StatuspageServiceStatus.UnderMaintenance, 'EAS Workflows is under maintenance.'],
  ])('describes the %s status', async (status, expectedWarning) => {
    jest
      .mocked(StatuspageServiceQuery.statuspageServicesAsync)
      .mockResolvedValue([makeService(StatuspageServiceName.EasWorkflows, status)]);

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasWorkflows]);

    expect(getWarnings()[0]).toContain(expectedWarning);
  });

  it('does not warn about an operational service', async () => {
    jest
      .mocked(StatuspageServiceQuery.statuspageServicesAsync)
      .mockResolvedValue([
        makeService(StatuspageServiceName.EasSimulator, StatuspageServiceStatus.Operational),
      ]);

    await maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasSimulator]);

    expect(Log.warn).not.toHaveBeenCalled();
  });

  it('does not fail the command when the status query fails', async () => {
    jest
      .mocked(StatuspageServiceQuery.statuspageServicesAsync)
      .mockRejectedValue(new Error('Variable "$serviceNames" got invalid value'));

    await expect(
      maybeWarnAboutEasOutagesAsync(graphqlClient, [StatuspageServiceName.EasSimulator])
    ).resolves.toBeUndefined();
    expect(Log.warn).not.toHaveBeenCalled();
  });
});
