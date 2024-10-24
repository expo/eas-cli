import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../graphql/client';
import { AppInfoQuery, AppInfoQueryVariables } from '../../graphql/generated';
import Log from '../../log';
import formatFields from '../../utils/formatFields';

async function projectInfoByIdAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string
): Promise<AppInfoQuery> {
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

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ProjectInfo, {
      nonInteractive: true,
    });

    const { app } = await projectInfoByIdAsync(graphqlClient, projectId);
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
