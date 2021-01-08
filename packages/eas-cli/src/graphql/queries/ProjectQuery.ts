import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { Project } from '../generated';

type ProjectQueryResult = Pick<Project, 'id'>;

const ProjectQuery = {
  async byUsernameAndSlugAsync(username: string, slug: string): Promise<ProjectQueryResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ project: { byUsernameAndSlug: ProjectQueryResult } }>(
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

export { ProjectQuery };
