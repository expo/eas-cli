import { getConfig } from '@expo/config';
import { Command } from '@oclif/command';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { AppInfoQuery, AppInfoQueryVariables } from '../../graphql/generated';
import Log from '../../log';
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
        { appId }
      )
      .toPromise()
  );

  return data;
}

export default class ProjectInfo extends Command {
  static description = 'information about the current project';

  async run(): Promise<void> {
    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
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
