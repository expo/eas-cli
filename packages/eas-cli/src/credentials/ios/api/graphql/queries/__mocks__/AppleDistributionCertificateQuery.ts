const AppleDistributionCertificateQuery = {
  getAllForAccount: jest.fn().mockImplementation(() => {
    return [
      {
        id: '6a7422cc-392b-451d-984c-b0b4b027680a',
        certificateP12: 'test-cert-p12-1',
        certificatePassword: 'test-cert-password-1',
        serialNumber: '5544BE191B9F949E',
        developerPortalIdentifier: 'JRH7292L8R',
        validityNotBefore: '2020-06-22T20:46:07.000Z',
        validityNotAfter: '2021-06-22T20:46:07.000Z',
        appleTeam: {
          id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
          appleTeamIdentifier: '77KQ969CHE',
          appleTeamName: null,
          __typename: 'AppleTeam',
        },
        iosAppBuildCredentialsList: [],
        updatedAt: '2020-06-22T20:46:07.000Z',
        __typename: 'AppleDistributionCertificate',
      },
      {
        id: '8b3baa53-b149-4a1b-842b-75ff6e0bcb1e',
        certificateP12: 'test-cert-p12-2',
        certificatePassword: 'test-cert-password-2',
        serialNumber: '3F9CDD6CFC6E52C1',
        developerPortalIdentifier: '5URSS525PL',
        validityNotBefore: '2020-10-13T18:28:44.000Z',
        validityNotAfter: '2021-10-13T18:28:44.000Z',
        appleTeam: {
          id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
          appleTeamIdentifier: '77KQ969CHE',
          appleTeamName: null,
          __typename: 'AppleTeam',
        },
        iosAppBuildCredentialsList: [],
        updatedAt: '2020-06-22T20:46:07.000Z',
        __typename: 'AppleDistributionCertificate',
      },
    ];
  }),
};

export { AppleDistributionCertificateQuery };
