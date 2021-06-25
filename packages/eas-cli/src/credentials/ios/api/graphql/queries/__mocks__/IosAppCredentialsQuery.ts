const IosAppCredentialsQuery = {
  withCommonFieldsByAppIdentifierIdAsync: jest.fn().mockImplementation(() => {
    return {
      id: '48d0cd34-96d8-447c-9de8-40dd2c3ca0f8',
      app: {
        id: '033134f3-e85c-4bde-9065-41a9c066ec31',
        fullName: '@quinlanj/test52',
        __typename: 'App',
      },
      appleTeam: {
        id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
        appleTeamIdentifier: 'test-apple-identifier',
        appleTeamName: null,
        __typename: 'AppleTeam',
      },
      appleAppIdentifier: {
        id: 'bd9c3609-26b9-451e-8ba6-e0604736c7fc',
        bundleIdentifier: 'com.quinlanj.test52',
        __typename: 'AppleAppIdentifier',
      },
      pushKey: {
        id: '74bdd007-da7b-4190-a571-edb87e9324a1',
        keyIdentifier: '9839M6AY8W',
        updatedAt: '2020-10-13T18:39:04.463Z',
        appleTeam: {
          id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
          appleTeamIdentifier: '77KQ969CHE',
          appleTeamName: null,
          __typename: 'AppleTeam',
        },
        __typename: 'ApplePushKey',
      },
      appSpecificPassword: {
        id: '64bdd007-da7b-4190-a571-edb87e9324a1',
        appleIdUsername: 'quin@expo.io',
        passwordLabel: 'description for super secret password',
        updatedAt: '2020-10-13T18:39:04.463Z',
        __typename: 'AppleAppSpecificPassword',
      },
      iosAppBuildCredentialsList: [
        {
          id: '6f8d0175-0caf-4922-b09b-eae757b83144',
          iosDistributionType: 'APP_STORE',
          distributionCertificate: {
            id: '8b3baa53-b149-4a1b-842b-75ff6e0bcb1e',
            certificateP12: 'test-cert-p12',
            certificatePassword: 'test-cert-password',
            serialNumber: 'test-serial',
            developerPortalIdentifier: 'test-portal-id',
            validityNotBefore: '2020-10-13T18:28:44.000Z',
            validityNotAfter: '2021-10-13T18:28:44.000Z',
            updatedAt: '2020-10-13T18:38:45.275Z',
            appleTeam: {
              id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
              appleTeamIdentifier: 'test-apple-identifier',
              appleTeamName: null,
              __typename: 'AppleTeam',
            },
            __typename: 'AppleDistributionCertificate',
          },
          provisioningProfile: {
            id: '01517f14-b4cf-489e-b1fd-3f5a61cb8df8',
            expiration: '2021-10-13T18:28:44.000Z',
            developerPortalIdentifier: 'test-profile-id',
            provisioningProfile: 'test-profile',
            updatedAt: '2020-10-29T00:18:32.130Z',
            status: 'active',
            appleDevices: [],
            appleTeam: {
              id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
              appleTeamIdentifier: 'test-apple-identifier',
              appleTeamName: null,
              __typename: 'AppleTeam',
            },
            __typename: 'AppleProvisioningProfile',
          },
          __typename: 'IosAppBuildCredentials',
        },
        {
          id: '3e1907a8-7114-4f14-9964-73467bc010ea',
          iosDistributionType: 'AD_HOC',
          distributionCertificate: {
            id: '8b3baa53-b149-4a1b-842b-75ff6e0bcb1e',
            certificateP12: 'test-cert-p12',
            certificatePassword: 'test-cert-password',
            serialNumber: 'test-serial',
            developerPortalIdentifier: 'test-portal-id',
            validityNotBefore: '2020-10-13T18:28:44.000Z',
            validityNotAfter: '2021-10-13T18:28:44.000Z',
            updatedAt: '2020-10-13T18:38:45.275Z',
            appleTeam: {
              id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
              appleTeamIdentifier: 'test-apple-identifier',
              appleTeamName: null,
              __typename: 'AppleTeam',
            },
            __typename: 'AppleDistributionCertificate',
          },
          provisioningProfile: {
            id: '01517f14-b4cf-489e-b1fd-3f5a61cb8df8',
            expiration: '2021-10-13T18:28:44.000Z',
            developerPortalIdentifier: 'test-profile-id',
            provisioningProfile: 'test-profile',
            updatedAt: '2020-10-29T00:18:32.130Z',
            status: 'active',
            appleDevices: [],
            appleTeam: {
              id: '6d39dbfe-a30a-44a4-bc36-d562e5963fa3',
              appleTeamIdentifier: 'test-apple-identifier',
              appleTeamName: null,
              __typename: 'AppleTeam',
            },
            __typename: 'AppleProvisioningProfile',
          },
          __typename: 'IosAppBuildCredentials',
        },
      ],
      __typename: 'IosAppCredentials',
    };
  }),
};

export { IosAppCredentialsQuery };
