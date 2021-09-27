import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Project, ProjectByUsernameAndSlugQuery } from '../generated';

type ProjectQueryResult = Pick<Project, 'id'>;

export const ProjectQuery = {
  async byUsernameAndSlugAsync(username: string, slug: string): Promise<ProjectQueryResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<ProjectByUsernameAndSlugQuery>(
          gql`
            query ProjectByUsernameAndSlugQuery($username: String!, $slug: String!) {
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
  },
};
