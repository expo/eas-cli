import { Flags } from '@oclif/core';
import Table from 'cli-table3';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { UpdatesByGroupQuery, UpdatesByGroupQueryVariables } from '../../graphql/generated';
import Log from '../../log';
import { UPDATE_COLUMNS, formatUpdate, getPlatformsForGroup } from '../../update/utils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

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
        },
        { additionalTypenames: ['Update'] }
      )
      .toPromise()
  );
  if (data.updatesByGroup.length === 0) {
    throw new Error(`Could not find any updates with group ID: "${groupId}"`);
  }
  return data;
}
export default class UpdateView extends EasCommand {
  static override description = 'update group details';

  static override args = [
    {
      name: 'groupId',
      required: true,
      description: 'The ID of an update group.',
    },
  ];

  static override flags = {
    json: Flags.boolean({
      description: `Return a json with the updates belonging to the group.`,
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const {
      args: { groupId },
      flags: { json: jsonFlag },
    } = await this.parse(UpdateView);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const { updatesByGroup } = await viewUpdateAsync({ groupId });

    if (jsonFlag) {
      printJsonOnlyOutput(updatesByGroup);
    } else {
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
          group: updatesByGroup[0]?.group,
        }),
      ]);

      Log.log(groupTable.toString());
    }
  }
}
