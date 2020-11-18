import { AppleTeam } from '../../../../../../graphql/types/credentials/AppleTeam';

const AppleTeamQuery = {
  byAppleTeamIdentifierAsync: jest.fn().mockImplementation(() => {
    const appleTeam: AppleTeam = {
      id: 'apple-team-id',
      appleTeamIdentifier: 'ABC123XZ',
      appleTeamName: 'John Doe (Individual)',
    };
    return appleTeam;
  }),
};

export { AppleTeamQuery };
