import gql from 'graphql-tag';

import { graphqlClient } from '../client';
import { Project } from '../types/Project';

type ProjectIdType = Pick<Project, 'id'>;

export class ProjectQuery {
  static async idByUsernameAndSlugAsync(username: string, slug: string): Promise<ProjectIdType> {
    const { data, error } = await graphqlClient
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
      .toPromise();
    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Returned data is empty!');
    }

    return data.project.byUsernameAndSlug;
  }
}
