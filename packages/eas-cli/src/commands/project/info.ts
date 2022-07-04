import { gql } from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand.js';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client.js';
import { AppInfoQuery, AppInfoQueryVariables } from '../../graphql/generated.js';
import Log from '../../log.js';
import { getExpoConfig } from '../../project/expoConfig.js';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils.js';
import formatFields from '../../utils/formatFields.js';

async function projectInfoByIdAsync(appId: string): Promise<AppInfoQuery> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .query<AppInfoQuery, AppInfoQueryVariables>(
        gql`
          query AppInfo($appId: String!) {
            app {
              byId(appId: $appId) {
                id
                fullName
              }
            }
          }
        `,
        { appId },
        { additionalTypenames: ['App'] }
      )
      .toPromise()
  );

  return data;
}

export default class ProjectInfo extends EasCommand {
  static description = 'information about the current project';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    const { app } = await projectInfoByIdAsync(projectId);
    if (!app) {
      throw new Error(`Could not find project with ID: ${projectId}`);
    }

    Log.addNewLineIfNone();
    Log.log(
      formatFields([
        { label: 'fullName', value: app.byId.fullName },
        { label: 'ID', value: projectId },
      ])
    );
  }
}
