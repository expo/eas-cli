import { Fragment } from '../../fragment';

export const AppleTeamFragment: Fragment = {
  name: 'appleTeam',
  definition: /* GraphQL*/ `
    fragment appleTeam on AppleTeam {
      id
      appleTeamIdentifier
      appleTeamName
    }
  `,
};
