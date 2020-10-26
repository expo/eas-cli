import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Project } from '../types/Project';

type ProjectQueryResult = Pick<Project, 'id'>;

export class ProjectQuery {
  static async byUsernameAndSlugAsync(username: string, slug: string): Promise<ProjectQueryResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ project: { byUsernameAndSlug: ProjectQueryResult } }>(
          gql`
            query($username: String!, $slug: String!) {
              project {
                byUsernameAndSlug(username: $username, slug: $slug) {
                  id
                }
              }
            }
          `,
          { username, slug }
        )
        .toPromise()
    );

    return data.project.byUsernameAndSlug;
  }
}
