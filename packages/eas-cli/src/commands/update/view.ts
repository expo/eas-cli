import { Command, flags } from '@oclif/command';
import Table from 'cli-table3';
import gql from 'graphql-tag';
import groupBy from 'lodash/groupBy';
import { format } from 'timeago.js';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  Maybe,
  Robot,
  Update,
  UpdatesByGroupQuery,
  UpdatesByGroupQueryVariables,
  User,
} from '../../graphql/generated';
import Log from '../../log';
import { getActorDisplayName } from '../../user/User';
export const UPDATE_COLUMNS = [
  'update description',
  'update runtime version',
  'update group ID',
  'platforms',
];

export type FormatUpdateParameter = Pick<Update, 'id' | 'createdAt' | 'message'> & {
  actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
};

export async function viewUpdateAsync({
  groupId,
}: {
  groupId: string;
}): Promise<UpdatesByGroupQuery> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<UpdatesByGroupQuery, UpdatesByGroupQueryVariables>(
        gql`
          query UpdatesByGroup($groupId: ID!) {
            updatesByGroup(group: $groupId) {
              id
              group
              runtimeVersion
              platform
              message
              actor {
                id
                ... on User {
                  username
                }
                ... on Robot {
                  firstName
                }
              }
              createdAt
            }
          }
        `,
        {
          groupId,
        }
      )
      .toPromise()
  );
  if (data.updatesByGroup.length === 0) {
    throw new Error(`Could not find any updates with group ID: "${groupId}"`);
  }
  return data;
}
export default class UpdateView extends Command {
  static hidden = true;
  static description = 'Update group details.';

  static args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group.',
    },
  ];

  static flags = {
    json: flags.boolean({
      description: `Return a json with the updates belonging to the group.`,
      default: false,
    }),
  };

  async run() {
    const {
      args: { groupId },
      flags: { json: jsonFlag },
    } = this.parse(UpdateView);

    const { updatesByGroup } = await viewUpdateAsync({ groupId });

    if (jsonFlag) {
      Log.log(JSON.stringify(updatesByGroup));
      return;
    }

    const groupTable = new Table({
      head: [...UPDATE_COLUMNS],
      wordWrap: true,
    });

    const representativeUpdate = updatesByGroup[0];
    groupTable.push([
      formatUpdate(representativeUpdate),
      representativeUpdate.runtimeVersion,
      representativeUpdate.group,
      getPlatformsForGroup({
        updates: updatesByGroup,
        group: updatesByGroup[0].group,
      }),
    ]);

    Log.log(groupTable.toString());
  }
}

export function getPlatformsForGroup({
  group,
  updates,
}: {
  group: string;
  updates: { group: string; platform: string }[];
}): string {
  const groupedUpdates = groupBy(updates, update => update.group);
  return groupedUpdates[group].map(update => update.platform).join(',');
}

export function formatUpdate(update: FormatUpdateParameter): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.message ? `"${update.message}" ` : '';
  return `${message}(${format(update.createdAt, 'en_US')} by ${getActorDisplayName(
    update.actor as any
  )})`;
}
