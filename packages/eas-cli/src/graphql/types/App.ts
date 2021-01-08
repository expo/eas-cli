import { Fragment } from '../fragment';

export const AppFragment: Fragment = {
  name: 'app',
  definition: /* GraphQL*/ `
    fragment app on App {
      id
    }
  `,
};
