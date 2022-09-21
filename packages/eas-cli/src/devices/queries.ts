import chalk from 'chalk';

import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { AppleDeviceQuery } from '../credentials/ios/api/graphql/queries/AppleDeviceQuery';
import { AppleTeamQuery } from '../credentials/ios/api/graphql/queries/AppleTeamQuery';
import { AppleDeviceFragment, AppleTeamFragment } from '../graphql/generated';
import Log from '../log';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';
import formatDevice, { AppleTeamIdAndName } from './utils/formatDevice';

export const TEAMS_LIMIT = 50;
export const DEVICES_LIMIT = 50;

export async function selectAppleTeamOnAccountAsync({
  accountName,
  selectionPromptTitle,
  paginatedQueryOptions,
}: {
  accountName: string;
  selectionPromptTitle: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<AppleTeamFragment> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select an apple team in non-interactive mode.');
  } else {
    const selectedAppleTeam = await paginatedQueryWithSelectPromptAsync({
      limit: paginatedQueryOptions.limit ?? TEAMS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        AppleTeamQuery.getAllForAccountAsync({
          accountName,
          limit,
          offset,
        }),
      promptOptions: {
        title: selectionPromptTitle,
        createDisplayTextForSelectionPromptListItem: appleTeam =>
          appleTeam.appleTeamName
            ? `${appleTeam.appleTeamName} (ID: ${appleTeam.appleTeamIdentifier})`
            : appleTeam.appleTeamIdentifier,
        getIdentifierForQueryItem: appleTeam => appleTeam.id,
      },
    });
    if (!selectedAppleTeam) {
      throw new Error(`Couldn't find any teams for the account ${accountName}`);
    }
    return selectedAppleTeam;
  }
}

export async function selectAppleDeviceOnAppleTeamAsync({
  accountName,
  appleTeamIdentifier,
  selectionPromptTitle,
  paginatedQueryOptions,
}: {
  accountName: string;
  appleTeamIdentifier: string;
  selectionPromptTitle: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<AppleDeviceFragment> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select an apple device in non-interactive mode.');
  } else {
    const selectedAppleDevice = await paginatedQueryWithSelectPromptAsync({
      limit: paginatedQueryOptions.limit ?? DEVICES_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        AppleDeviceQuery.getAllForAppleTeamAsync({
          accountName,
          appleTeamIdentifier,
          limit,
          offset,
        }),
      promptOptions: {
        title: selectionPromptTitle,
        createDisplayTextForSelectionPromptListItem: appleDevice => formatDevice(appleDevice),
        getIdentifierForQueryItem: appleTeam => appleTeam.id,
      },
    });
    if (!selectedAppleDevice) {
      throw new Error(
        `Couldn't find any devices on the apple team with the id ${appleTeamIdentifier}`
      );
    }
    return selectedAppleDevice;
  }
}

export async function listAndRenderAppleDevicesOnAppleTeamAsync({
  accountName,
  appleTeam,
  paginatedQueryOptions,
}: {
  accountName: string;
  appleTeam: AppleTeamIdAndName;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const devices = await AppleDeviceQuery.getAllForAppleTeamAsync({
      accountName,
      appleTeamIdentifier: appleTeam.appleTeamIdentifier,
    });
    renderPageOfAppleDevices({ devices, appleTeam, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? DEVICES_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        AppleDeviceQuery.getAllForAppleTeamAsync({
          accountName,
          appleTeamIdentifier: appleTeam.appleTeamIdentifier,
          limit,
          offset,
        }),
      promptOptions: {
        title: 'Load more devices?',
        renderListItems: devices =>
          renderPageOfAppleDevices({ devices, appleTeam, paginatedQueryOptions }),
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
  appleTeam?: AppleTeamIdAndName;
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  if (paginatedQueryOptions.json) {
    printJsonOnlyOutput(devices);
  } else {
    const list = devices
      .map(device => formatDevice(device, appleTeam))
      .join(`\n\n${chalk.dim('———')}\n\n`);

    Log.log(`\n${list}`);
  }
}
