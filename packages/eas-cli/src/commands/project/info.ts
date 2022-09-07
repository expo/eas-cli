import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { AppInfoQuery, AppInfoQueryVariables } from '../../graphql/generated';
import Log from '../../log';
import { getExpoConfig } from '../../project/expoConfig';
import { findProjectRootAsync, getProjectIdAsync } from '../../project/projectUtils';
import formatFields from '../../utils/formatFields';

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
  static override description = 'information about the current project';

  async runAsync(): Promise<void> {
    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    const { app } = await projectInfoByIdAsync(projectId);
    if (!app) {
      throw new Error(`Could not find project with id: ${projectId}`);
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
