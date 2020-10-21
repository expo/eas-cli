import gql from 'graphql-tag';

import { graphqlClient, withErrorHandling } from '../client';
import { Project } from '../types/Project';

type ProjectIdType = Pick<Project, 'id'>;

export class ProjectQuery {
  static async idByUsernameAndSlugAsync(username: string, slug: string): Promise<ProjectIdType> {
    const data = await withErrorHandling(
      graphqlClient
        .query<{ project: { byUsernameAndSlug: ProjectIdType } }>(
          gql`
        {
          project {
            byUsernameAndSlug(username: "${username}", slug: "${slug}", sdkVersions: []) {
              id
            }
          }
        }
      `
        )
        .toPromise()
    );

    return data.project.byUsernameAndSlug;
  }
}
