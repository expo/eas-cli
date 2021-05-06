import { getConfig } from '@expo/config';
import { EasJsonReader } from '@expo/eas-json';
import { Command } from '@oclif/command';
import fs from 'fs-extra';
import gql from 'graphql-tag';
import path from 'path';

import { graphqlClient, withErrorHandlingAsync } from '../graphql/client';
import { ProjectByIdQuery, ProjectByIdQueryVariables } from '../graphql/generated';
import Log from '../log';
import { ensureProjectExistsAsync } from '../project/ensureProjectExists';
import { findProjectRootAsync, getProjectAccountNameAsync } from '../project/projectUtils';

async function projectByIdAsync(projectId: string): Promise<ProjectByIdQuery> {
  return await withErrorHandlingAsync(
    graphqlClient
      .query<ProjectByIdQuery, ProjectByIdQueryVariables>(
        gql`
          query ProjectById($projectId: String!) {
            app {
              byId(appId: $projectId) {
                id
              }
            }
          }
        `,
        { projectId }
      )
      .toPromise()
  );
}

export default class InitView extends Command {
  static description = 'Create an EAS project.';

  async run() {
    const projectDir = await findProjectRootAsync(process.cwd());
    if (!projectDir) {
      throw new Error('Please run this command inside a project directory.');
    }
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const accountName = await getProjectAccountNameAsync(exp);
    const { slug } = exp;
    const appId = await ensureProjectExistsAsync({
      accountName,
      projectName: slug,
    });

    Log.log({ appId });

    const easJsonPath = path.join(projectDir, 'eas.json');

    let easJson = { appId };
    if (await fs.pathExists(easJsonPath)) {
      Log.withTick('Found eas.json');
      const reader = new EasJsonReader(projectDir, 'all');
      await reader.validateAsync();

      easJson = { ...easJson, ...(await reader.readRawAsync()) };
    }
    console.log('easJson', easJson);

    // await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  }
}
