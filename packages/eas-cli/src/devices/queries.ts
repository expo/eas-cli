import chalk from 'chalk';

import formatDevice, { AppleTeamIdAndName } from './utils/formatDevice';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { formatAppleTeam } from '../credentials/ios/actions/AppleTeamFormatting';
import { formatDeviceLabel } from '../credentials/ios/actions/DeviceUtils';
import { AppleDeviceQuery } from '../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import { AppleTeamQuery } from '../credentials/ios/api/graphql/queries/AppleTeamQuery';
import { AppleDeviceFragment, AppleTeamFragment } from '../graphql/generated';
import Log from '../log';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';

export const TEAMS_LIMIT = 50;
export const DEVICES_LIMIT = 50;

export async function selectAppleTeamOnAccountAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    accountName,
    selectionPromptTitle,
    paginatedQueryOptions,
  }: {
    accountName: string;
    selectionPromptTitle: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<AppleTeamFragment> {
  if (paginatedQueryOptions.nonInteractive) {
    const teams = await AppleTeamQuery.getAllForAccountAsync(graphqlClient, {
      accountName,
      limit: paginatedQueryOptions.limit ?? TEAMS_LIMIT,
      offset: paginatedQueryOptions.offset,
    });
    if (teams.length === 0) {
      throw new Error(`No Apple teams found for account ${accountName}.`);
    }
    const teamList = teams
      .map(t =>
        t.appleTeamName
          ? `${t.appleTeamName} (${t.appleTeamIdentifier})`
          : t.appleTeamIdentifier
      )
      .join('\n  ');
    throw new Error(
      `Unable to select an Apple team in non-interactive mode. Use the --apple-team-id flag to specify the team. Available Apple teams for account ${accountName}:\n  ${teamList}`
    );
  } else {
    const selectedAppleTeam = await paginatedQueryWithSelectPromptAsync({
      limit: paginatedQueryOptions.limit ?? TEAMS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        AppleTeamQuery.getAllForAccountAsync(graphqlClient, {
          accountName,
          limit,
          offset,
        }),
      promptOptions: {
        title: selectionPromptTitle,
        makePartialChoiceObject: appleTeam => ({
          title: appleTeam.appleTeamName
            ? `${appleTeam.appleTeamName} (ID: ${appleTeam.appleTeamIdentifier})`
            : appleTeam.appleTeamIdentifier,
        }),
        getIdentifierForQueryItem: appleTeam => appleTeam.id,
      },
    });
    if (!selectedAppleTeam) {
      throw new Error(`Couldn't find any teams for the account ${accountName}`);
    }
    return selectedAppleTeam;
  }
}

export async function selectAppleDeviceOnAppleTeamAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    accountName,
    appleTeamIdentifier,
    selectionPromptTitle,
    paginatedQueryOptions,
  }: {
    accountName: string;
    appleTeamIdentifier: string;
    selectionPromptTitle: string;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<AppleDeviceFragment> {
  if (paginatedQueryOptions.nonInteractive) {
    const devices = await AppleDeviceQuery.getAllForAppleTeamAsync(graphqlClient, {
      accountName,
      appleTeamIdentifier,
      limit: paginatedQueryOptions.limit ?? DEVICES_LIMIT,
      offset: paginatedQueryOptions.offset,
    });
    if (devices.length === 0) {
      throw new Error(
        `No devices found on Apple team ${appleTeamIdentifier} for account ${accountName}.`
      );
    }
    const deviceList = devices
      .map(d => formatDeviceLabel(d))
      .join('\n  ');
    throw new Error(
      `Unable to select an Apple device in non-interactive mode. Available devices on Apple team ${appleTeamIdentifier}:\n  ${deviceList}`
    );
  } else {
    const selectedAppleDevice = await paginatedQueryWithSelectPromptAsync({
      limit: paginatedQueryOptions.limit ?? DEVICES_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        AppleDeviceQuery.getAllForAppleTeamAsync(graphqlClient, {
          accountName,
          appleTeamIdentifier,
          limit,
          offset,
        }),
      promptOptions: {
        title: selectionPromptTitle,
        makePartialChoiceObject: appleDevice => ({
          title: formatDeviceLabel(appleDevice),
        }),
        getIdentifierForQueryItem: appleTeam => appleTeam.id,
      },
    });
    if (!selectedAppleDevice) {
      throw new Error(
        `Couldn't find any devices on the Apple team with the id ${appleTeamIdentifier}`
      );
    }
    return selectedAppleDevice;
  }
}

export async function listAndRenderAppleDevicesOnAppleTeamAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    accountName,
    appleTeam,
    paginatedQueryOptions,
  }: {
    accountName: string;
    appleTeam: AppleTeamIdAndName;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const devices = await AppleDeviceQuery.getAllForAppleTeamAsync(graphqlClient, {
      accountName,
      appleTeamIdentifier: appleTeam.appleTeamIdentifier,
      offset: paginatedQueryOptions.offset,
      limit: paginatedQueryOptions.limit,
    });
    renderPageOfAppleDevices({ devices, appleTeam, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? DEVICES_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        AppleDeviceQuery.getAllForAppleTeamAsync(graphqlClient, {
          accountName,
          appleTeamIdentifier: appleTeam.appleTeamIdentifier,
          limit,
          offset,
        }),
      promptOptions: {
        title: 'Load more devices?',
        renderListItems: devices => {
          renderPageOfAppleDevices({ devices, appleTeam, paginatedQueryOptions });
        },
      },
    });
  }
}

function renderPageOfAppleDevices({
  devices,
  appleTeam,
  paginatedQueryOptions,
}: {
  devices: AppleDeviceFragment[];
  appleTeam: AppleTeamIdAndName;
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  if (paginatedQueryOptions.json) {
    printJsonOnlyOutput(devices);
  } else {
    if (devices.length === 0) {
      Log.log(
        `Could not find devices on Apple team -- ${formatAppleTeam({
          appleTeamIdentifier: appleTeam.appleTeamIdentifier,
          appleTeamName: appleTeam.appleTeamName,
        })}`
      );
    } else {
      const list = devices
        .map(device => formatDevice(device, appleTeam))
        .join(`\n\n${chalk.dim('———')}\n\n`);

      Log.log(`\n${list}`);
      Log.addNewLineIfNone();
    }
  }
}
