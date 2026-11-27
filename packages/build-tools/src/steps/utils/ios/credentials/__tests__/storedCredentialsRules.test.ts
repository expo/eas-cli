import { Ios } from '@expo/eas-build-job';
import plist from '@expo/plist';

import { createTestProvisioningProfileBase64 } from '../../../../../__tests__/utils/provisioningProfile';
import {
  IosDistributionType,
  StoredIosAppCredentials,
  StoredIosBuildCredentials,
} from '../storedCredentialsQueries';
import {
  IosSigningRequest,
  selectStoredIosBuildCredentials,
  validateStoredIosBuildCredentials,
} from '../storedCredentialsRules';
import { provisioningProfile as appleIssuedProvisioningProfile } from './fixtures';

const APP = { name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' };
const WIDGET = { name: 'Widget', bundleIdentifier: 'dev.expo.nativeapp.widget' };
const NOW = new Date('2026-11-24T12:00:00.000Z');
const CREDENTIALS_PAGE = 'the Credentials page of the project on expo.dev';
const VALID_DISTRIBUTION_CERTIFICATE = {
  dataBase64: 'Y2VydGlmaWNhdGU=',
  password: 'password',
  validityNotBefore: new Date('2026-01-01T00:00:00.000Z'),
  validityNotAfter: new Date('2027-01-01T00:00:00.000Z'),
};

function createBuildCredentials(
  overrides: Partial<StoredIosBuildCredentials> = {}
): StoredIosBuildCredentials {
  return {
    distributionCertificate: VALID_DISTRIBUTION_CERTIFICATE,
    provisioningProfileBase64: createTestProvisioningProfileBase64({
      bundleIdentifierPattern: APP.bundleIdentifier,
    }),
    ...overrides,
  };
}

describe(selectStoredIosBuildCredentials, () => {
  const storedForBothTargets: StoredIosAppCredentials[] = [
    {
      appleAppIdentifierId: 'widget-identifier-id',
      bundleIdentifier: WIDGET.bundleIdentifier,
      iosDistributionTypes: ['APP_STORE', 'AD_HOC', 'ENTERPRISE'],
    },
    {
      appleAppIdentifierId: 'app-identifier-id',
      bundleIdentifier: APP.bundleIdentifier,
      iosDistributionTypes: ['ENTERPRISE', 'AD_HOC', 'APP_STORE'],
    },
  ];

  it.each([
    [{ distribution: 'store' } as const, 'APP_STORE'],
    [{ distribution: 'internal', enterpriseProvisioning: 'adhoc' } as const, 'AD_HOC'],
    [{ distribution: 'internal', enterpriseProvisioning: 'universal' } as const, 'ENTERPRISE'],
  ])('selects for %o the %s credentials of each target', (request, iosDistributionType) => {
    expect(selectStoredIosBuildCredentials([APP, WIDGET], storedForBothTargets, request)).toEqual({
      iosDistributionType,
      targets: [
        { target: APP, appleAppIdentifierId: 'app-identifier-id' },
        { target: WIDGET, appleAppIdentifierId: 'widget-identifier-id' },
      ],
    });
  });

  it.each(['AD_HOC', 'ENTERPRISE'] as const)(
    'selects for internal distribution the %s credentials when they are the only type for internal distribution that is stored',
    iosDistributionType => {
      const stored: StoredIosAppCredentials[] = [
        {
          appleAppIdentifierId: 'app-identifier-id',
          bundleIdentifier: APP.bundleIdentifier,
          iosDistributionTypes: ['APP_STORE', 'DEVELOPMENT', iosDistributionType],
        },
      ];

      expect(selectStoredIosBuildCredentials([APP], stored, { distribution: 'internal' })).toEqual({
        iosDistributionType,
        targets: [{ target: APP, appleAppIdentifierId: 'app-identifier-id' }],
      });
    }
  );

  it('asks for enterprise_provisioning when ad hoc and enterprise credentials are stored', () => {
    expect(() =>
      selectStoredIosBuildCredentials([APP], storedForBothTargets, { distribution: 'internal' })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
        message:
          'Both ad hoc and enterprise credentials are stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp"). Set "enterprise_provisioning" to "adhoc" or "universal" in the params of the build job to choose the credentials that sign the build.',
      })
    );
  });

  it('asks for enterprise_provisioning when one target has both types and another target has one', () => {
    const stored: StoredIosAppCredentials[] = [
      {
        appleAppIdentifierId: 'app-identifier-id',
        bundleIdentifier: APP.bundleIdentifier,
        iosDistributionTypes: ['AD_HOC', 'ENTERPRISE'],
      },
      {
        appleAppIdentifierId: 'widget-identifier-id',
        bundleIdentifier: WIDGET.bundleIdentifier,
        iosDistributionTypes: ['AD_HOC'],
      },
    ];

    expect(() =>
      selectStoredIosBuildCredentials([APP, WIDGET], stored, { distribution: 'internal' })
    ).toThrow(
      'Both ad hoc and enterprise credentials are stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp").'
    );
  });

  it('names every target that has no credentials of the needed type', () => {
    const stored: StoredIosAppCredentials[] = [
      {
        appleAppIdentifierId: 'app-identifier-id',
        bundleIdentifier: APP.bundleIdentifier,
        iosDistributionTypes: ['AD_HOC'],
      },
    ];

    expect(() =>
      selectStoredIosBuildCredentials([APP, WIDGET], stored, { distribution: 'store' })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
        message: [
          `No App Store credentials are stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp"). A build with distribution "store" needs App Store credentials: a distribution certificate and a provisioning profile. Add them on ${CREDENTIALS_PAGE}.`,
          `No App Store credentials are stored for the bundle identifier "dev.expo.nativeapp.widget" (target "Widget"). A build with distribution "store" needs App Store credentials: a distribution certificate and a provisioning profile. Add them on ${CREDENTIALS_PAGE}.`,
        ].join('\n'),
      })
    );
  });

  it.each([
    [{ distribution: 'internal' } as const, 'No ad hoc or enterprise credentials are stored'],
    [
      { distribution: 'internal', enterpriseProvisioning: 'universal' } as const,
      'A build with distribution "internal" and enterprise_provisioning "universal" needs enterprise credentials',
    ],
  ])('does not select development credentials for %o', (request, expectedMessage) => {
    const stored: StoredIosAppCredentials[] = [
      {
        appleAppIdentifierId: 'app-identifier-id',
        bundleIdentifier: APP.bundleIdentifier,
        iosDistributionTypes: ['DEVELOPMENT'],
      },
    ];

    expect(() => selectStoredIosBuildCredentials([APP], stored, request)).toThrow(expectedMessage);
  });

  it('does not use the credentials of a wildcard identifier', () => {
    const stored: StoredIosAppCredentials[] = [
      {
        appleAppIdentifierId: 'wildcard-identifier-id',
        bundleIdentifier: 'dev.expo.*',
        iosDistributionTypes: ['APP_STORE'],
      },
    ];

    expect(() => selectStoredIosBuildCredentials([APP], stored, { distribution: 'store' })).toThrow(
      'No App Store credentials are stored for the bundle identifier "dev.expo.nativeapp"'
    );
  });

  it('asks for enterprise_provisioning when the targets have credentials of different types', () => {
    const stored: StoredIosAppCredentials[] = [
      {
        appleAppIdentifierId: 'app-identifier-id',
        bundleIdentifier: APP.bundleIdentifier,
        iosDistributionTypes: ['AD_HOC'],
      },
      {
        appleAppIdentifierId: 'widget-identifier-id',
        bundleIdentifier: WIDGET.bundleIdentifier,
        iosDistributionTypes: ['ENTERPRISE'],
      },
    ];

    expect(() =>
      selectStoredIosBuildCredentials([APP, WIDGET], stored, { distribution: 'internal' })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
        message: `The targets of this build have credentials of different types: ad hoc for the bundle identifier "dev.expo.nativeapp" (target "NativeApp"), enterprise for the bundle identifier "dev.expo.nativeapp.widget" (target "Widget"). EAS signs all targets of a build with one type. Set "enterprise_provisioning" to "adhoc" or "universal" in the params of the build job, and add credentials of that type for each bundle identifier on ${CREDENTIALS_PAGE}.`,
      })
    );
  });
});

describe(validateStoredIosBuildCredentials, () => {
  const STORE_OPTIONS = {
    iosDistributionType: 'APP_STORE',
    request: { distribution: 'store' },
    now: NOW,
  } as const;

  it('returns the credentials of each target by target name', () => {
    const appBuildCredentials = createBuildCredentials();
    const widgetBuildCredentials = createBuildCredentials({
      distributionCertificate: { ...VALID_DISTRIBUTION_CERTIFICATE, password: null },
      provisioningProfileBase64: createTestProvisioningProfileBase64({
        bundleIdentifierPattern: WIDGET.bundleIdentifier,
      }),
    });

    expect(
      validateStoredIosBuildCredentials(
        [
          { target: APP, buildCredentials: appBuildCredentials },
          { target: WIDGET, buildCredentials: widgetBuildCredentials },
        ],
        STORE_OPTIONS
      )
    ).toEqual({
      NativeApp: {
        provisioningProfileBase64: appBuildCredentials.provisioningProfileBase64,
        distributionCertificate: { dataBase64: 'Y2VydGlmaWNhdGU=', password: 'password' },
      },
      Widget: {
        provisioningProfileBase64: widgetBuildCredentials.provisioningProfileBase64,
        distributionCertificate: { dataBase64: 'Y2VydGlmaWNhdGU=', password: '' },
      },
    });
  });

  it.each(['dev.expo.nativeapp', 'dev.expo.*', '*'])(
    'accepts a provisioning profile for "%s"',
    bundleIdentifierPattern => {
      const buildCredentials = createBuildCredentials({
        provisioningProfileBase64: createTestProvisioningProfileBase64({ bundleIdentifierPattern }),
      });

      expect(
        validateStoredIosBuildCredentials([{ target: APP, buildCredentials }], STORE_OPTIONS)
      ).toHaveProperty('NativeApp');
    }
  );

  it('reads a provisioning profile in the signed format that Apple issues', () => {
    const target = {
      name: 'TestApp',
      bundleIdentifier: 'org.reactjs.native.example.testapp.turtlev2',
    };
    const buildCredentials = createBuildCredentials({
      provisioningProfileBase64: appleIssuedProvisioningProfile.dataBase64,
    });
    const expirationDate = new Date('2026-06-10T08:22:49.000Z');

    expect(
      validateStoredIosBuildCredentials([{ target, buildCredentials }], {
        ...STORE_OPTIONS,
        now: new Date(expirationDate.getTime() - 1),
      })
    ).toHaveProperty('TestApp');
    expect(() =>
      validateStoredIosBuildCredentials([{ target, buildCredentials }], {
        ...STORE_OPTIONS,
        now: expirationDate,
      })
    ).toThrow('expired on 6/10/2026, 8:22:49 AM UTC');
  });

  it.each([
    [
      'the record has no distribution certificate and no provisioning profile',
      createBuildCredentials({ distributionCertificate: null, provisioningProfileBase64: null }),
      `The App Store credentials stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") have no distribution certificate and no provisioning profile. Complete the credentials on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the record has no distribution certificate',
      createBuildCredentials({ distributionCertificate: null }),
      `The App Store credentials stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") have no distribution certificate. Complete the credentials on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the record has no provisioning profile',
      createBuildCredentials({ provisioningProfileBase64: null }),
      `The App Store credentials stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") have no provisioning profile. Complete the credentials on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the distribution certificate is not valid yet',
      createBuildCredentials({
        distributionCertificate: {
          ...VALID_DISTRIBUTION_CERTIFICATE,
          validityNotBefore: new Date(NOW.getTime() + 1000),
        },
      }),
      `The distribution certificate of the App Store credentials for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") is not valid until 11/24/2026, 12:00:01 PM UTC. Upload a distribution certificate that is valid now, and a provisioning profile made with it, on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the distribution certificate expires now',
      createBuildCredentials({
        distributionCertificate: { ...VALID_DISTRIBUTION_CERTIFICATE, validityNotAfter: NOW },
      }),
      `The distribution certificate of the App Store credentials for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") expired on 11/24/2026, 12:00:00 PM UTC. Upload a new distribution certificate, and a provisioning profile made with it, on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the provisioning profile expires now',
      createBuildCredentials({
        provisioningProfileBase64: createTestProvisioningProfileBase64({
          bundleIdentifierPattern: APP.bundleIdentifier,
          expirationDate: NOW,
        }),
      }),
      `The App Store provisioning profile for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") expired on 11/24/2026, 12:00:00 PM UTC. Upload a new provisioning profile on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the provisioning profile is for another bundle identifier',
      createBuildCredentials({
        provisioningProfileBase64: createTestProvisioningProfileBase64({
          bundleIdentifierPattern: 'dev.expo.nativeapp.widget',
        }),
      }),
      `The App Store provisioning profile stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") is for the bundle identifier "dev.expo.nativeapp.widget". Upload a provisioning profile for "dev.expo.nativeapp" on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the provisioning profile is for a wildcard that does not cover the bundle identifier',
      createBuildCredentials({
        provisioningProfileBase64: createTestProvisioningProfileBase64({
          bundleIdentifierPattern: 'dev.expo.other.*',
        }),
      }),
      `The App Store provisioning profile stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") is for the bundle identifier "dev.expo.other.*". Upload a provisioning profile for "dev.expo.nativeapp" on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the provisioning profile is not a property list',
      createBuildCredentials({
        provisioningProfileBase64: Buffer.from('not a property list').toString('base64'),
      }),
      `EAS could not read the App Store provisioning profile stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp"). Upload the provisioning profile again on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the provisioning profile has an expiration date that is not a date',
      createBuildCredentials({
        provisioningProfileBase64: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>ExpirationDate</key><date>not-a-date</date><key>Entitlements</key><dict><key>application-identifier</key><string>ABCDE12345.dev.expo.nativeapp</string></dict></dict></plist>'
        ).toString('base64'),
      }),
      `EAS could not read the App Store provisioning profile stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp"). Upload the provisioning profile again on ${CREDENTIALS_PAGE}.`,
    ],
    [
      'the provisioning profile names no application identifier',
      createBuildCredentials({
        provisioningProfileBase64: Buffer.from(
          plist.build({ ExpirationDate: new Date('2027-06-01T00:00:00.000Z'), Entitlements: {} })
        ).toString('base64'),
      }),
      `EAS could not read the App Store provisioning profile stored for the bundle identifier "dev.expo.nativeapp" (target "NativeApp"). Upload the provisioning profile again on ${CREDENTIALS_PAGE}.`,
    ],
  ])('fails when %s', (_description, buildCredentials, message) => {
    expect(() =>
      validateStoredIosBuildCredentials([{ target: APP, buildCredentials }], STORE_OPTIONS)
    ).toThrow(expect.objectContaining({ errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE', message }));
  });

  describe('the type of the provisioning profile, by the rule of eas-cli for local credentials', () => {
    function validateProfileOfType(
      profileType: IosDistributionType,
      credentialsType: IosDistributionType,
      request: IosSigningRequest
    ): Ios.BuildCredentials {
      const buildCredentials = createBuildCredentials({
        provisioningProfileBase64: createTestProvisioningProfileBase64({
          bundleIdentifierPattern: APP.bundleIdentifier,
          type: profileType,
        }),
      });
      return validateStoredIosBuildCredentials([{ target: APP, buildCredentials }], {
        iosDistributionType: credentialsType,
        request,
        now: NOW,
      });
    }

    it.each([
      ['APP_STORE', 'APP_STORE', { distribution: 'store' }],
      ['ENTERPRISE', 'APP_STORE', { distribution: 'store' }],
      ['AD_HOC', 'AD_HOC', { distribution: 'internal' }],
      ['ENTERPRISE', 'ENTERPRISE', { distribution: 'internal' }],
      ['DEVELOPMENT', 'AD_HOC', { distribution: 'internal' }],
      ['AD_HOC', 'AD_HOC', { distribution: 'internal', enterpriseProvisioning: 'adhoc' }],
      [
        'ENTERPRISE',
        'ENTERPRISE',
        { distribution: 'internal', enterpriseProvisioning: 'universal' },
      ],
    ] as const)(
      'accepts a profile of the type %s in %s credentials for %o',
      (profileType, credentialsType, request) => {
        expect(validateProfileOfType(profileType, credentialsType, request)).toHaveProperty(
          'NativeApp'
        );
      }
    );

    it.each([
      ['AD_HOC', 'APP_STORE', { distribution: 'store' }],
      ['DEVELOPMENT', 'APP_STORE', { distribution: 'store' }],
      ['APP_STORE', 'AD_HOC', { distribution: 'internal' }],
      ['APP_STORE', 'AD_HOC', { distribution: 'internal', enterpriseProvisioning: 'adhoc' }],
      ['ENTERPRISE', 'AD_HOC', { distribution: 'internal', enterpriseProvisioning: 'adhoc' }],
      ['DEVELOPMENT', 'AD_HOC', { distribution: 'internal', enterpriseProvisioning: 'adhoc' }],
      [
        'APP_STORE',
        'ENTERPRISE',
        { distribution: 'internal', enterpriseProvisioning: 'universal' },
      ],
      ['AD_HOC', 'ENTERPRISE', { distribution: 'internal', enterpriseProvisioning: 'universal' }],
      [
        'DEVELOPMENT',
        'ENTERPRISE',
        { distribution: 'internal', enterpriseProvisioning: 'universal' },
      ],
    ] as const)(
      'rejects a profile of the type %s in %s credentials for %o',
      (profileType, credentialsType, request) => {
        expect(() => validateProfileOfType(profileType, credentialsType, request)).toThrow(
          'cannot use a provisioning profile of that type'
        );
      }
    );

    it('names the type of the profile, the build that cannot use it and the type to upload', () => {
      expect(() =>
        validateProfileOfType('APP_STORE', 'AD_HOC', {
          distribution: 'internal',
          enterpriseProvisioning: 'adhoc',
        })
      ).toThrow(
        expect.objectContaining({
          errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
          message: `The provisioning profile of the ad hoc credentials for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") has the type "App Store". A build with distribution "internal" and enterprise_provisioning "adhoc" cannot use a provisioning profile of that type. Upload a provisioning profile of the type "ad hoc" on ${CREDENTIALS_PAGE}.`,
        })
      );
    });

    it('reports the type before the expiry of a profile that has both problems', () => {
      const buildCredentials = createBuildCredentials({
        provisioningProfileBase64: createTestProvisioningProfileBase64({
          bundleIdentifierPattern: APP.bundleIdentifier,
          expirationDate: NOW,
          type: 'AD_HOC',
        }),
      });

      expect(() =>
        validateStoredIosBuildCredentials([{ target: APP, buildCredentials }], STORE_OPTIONS)
      ).toThrow('has the type "ad hoc"');
    });
  });

  it('names the type of the credentials and every problem of every target', () => {
    const expiredCertificateAndProfile = createBuildCredentials({
      distributionCertificate: {
        ...VALID_DISTRIBUTION_CERTIFICATE,
        validityNotAfter: new Date('2026-11-02T00:00:00.000Z'),
      },
      provisioningProfileBase64: createTestProvisioningProfileBase64({
        bundleIdentifierPattern: APP.bundleIdentifier,
        expirationDate: new Date('2026-11-01T00:00:00.000Z'),
        type: 'ENTERPRISE',
      }),
    });

    expect(() =>
      validateStoredIosBuildCredentials(
        [
          { target: APP, buildCredentials: expiredCertificateAndProfile },
          {
            target: WIDGET,
            buildCredentials: createBuildCredentials({
              distributionCertificate: null,
              provisioningProfileBase64: createTestProvisioningProfileBase64({
                bundleIdentifierPattern: WIDGET.bundleIdentifier,
                type: 'ENTERPRISE',
              }),
            }),
          },
        ],
        {
          iosDistributionType: 'ENTERPRISE',
          request: { distribution: 'internal', enterpriseProvisioning: 'universal' },
          now: NOW,
        }
      )
    ).toThrow(
      [
        `The distribution certificate of the enterprise credentials for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") expired on 11/2/2026, 12:00:00 AM UTC. Upload a new distribution certificate, and a provisioning profile made with it, on ${CREDENTIALS_PAGE}.`,
        `The enterprise provisioning profile for the bundle identifier "dev.expo.nativeapp" (target "NativeApp") expired on 11/1/2026, 12:00:00 AM UTC. Upload a new provisioning profile on ${CREDENTIALS_PAGE}.`,
        `The enterprise credentials stored for the bundle identifier "dev.expo.nativeapp.widget" (target "Widget") have no distribution certificate. Complete the credentials on ${CREDENTIALS_PAGE}.`,
      ].join('\n')
    );
  });
});
