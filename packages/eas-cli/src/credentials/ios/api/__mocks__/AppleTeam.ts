const findAppleTeamAsync = jest.fn().mockImplementation(() => {
  return {
    id: 'apple-team-id',
    account: {
      id: 'account-id',
      name: 'account name',
    },
    appleTeamIdentifier: 'ABC123XZ',
    appleTeamName: 'John Doe (Individual)',
  };
});

export { findAppleTeamAsync };
