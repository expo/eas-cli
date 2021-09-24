import { AppleTeam } from '../../../../../../graphql/generated';

export const AppleTeamQuery = {
  byAppleTeamIdentifierAsync: jest.fn().mockImplementation(() => {
    const appleTeam: Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'> = {
      id: 'apple-team-id',
      appleTeamIdentifier: 'ABC123XZ',
      appleTeamName: 'John Doe (Individual)',
    };
    return appleTeam;
  }),
};
