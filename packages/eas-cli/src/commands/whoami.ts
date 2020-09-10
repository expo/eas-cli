import { Command } from '@oclif/command';
import gql from 'graphql-tag';

import { graphqlClient } from '../utils/api';

export default class Whoami extends Command {
  static description = 'show the username you are logged in as';

  async run() {
    const { data } = await graphqlClient
      .query(
        gql`
          {
            viewer {
              username
            }
          }
        `
      )
      .toPromise();
    if (data?.viewer?.username) {
      this.log(data.viewer.username);
    } else {
      throw new Error('Not logged in.');
    }
  }
}
