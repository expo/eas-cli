import { gql } from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client.js';
import { Project, ProjectByUsernameAndSlugQuery } from '../generated.js';

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
          { username, slug },
          {
            additionalTypenames: ['App', 'Snack'] /* typenames that use the Project type*/,
          }
        )
        .toPromise()
    );

    return data.project.byUsernameAndSlug;
  },
};
