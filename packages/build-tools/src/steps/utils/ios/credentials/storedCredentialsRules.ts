import { Ios, UserError } from '@expo/eas-build-job';
import plist from '@expo/plist';

import { DistributionType, resolveDistributionType } from './provisioningProfile';
import {
  IosDistributionType,
  StoredIosAppCredentials,
  StoredIosBuildCredentials,
} from './storedCredentialsQueries';

const ERROR_CODE = 'NATIVE_IOS_CREDENTIALS_NOT_USABLE';
const CREDENTIALS_PAGE = 'the Credentials page of the project on expo.dev';

const IOS_DISTRIBUTION_TYPE_LABELS: Record<IosDistributionType, string> = {
  APP_STORE: 'App Store',
  AD_HOC: 'ad hoc',
  ENTERPRISE: 'enterprise',
  DEVELOPMENT: 'development',
};

export interface IosSigningTarget {
  name: string;
  bundleIdentifier: string;
}

export type IosSigningRequest = { distribution: NonNullable<Ios.Job['distribution']> } & Pick<
  Ios.Job,
  'enterpriseProvisioning'
>;

const IOS_DISTRIBUTION_TYPE_BY_PROFILE_TYPE: Record<DistributionType, IosDistributionType> = {
  [DistributionType.APP_STORE]: 'APP_STORE',
  [DistributionType.AD_HOC]: 'AD_HOC',
  [DistributionType.ENTERPRISE]: 'ENTERPRISE',
  [DistributionType.DEVELOPMENT]: 'DEVELOPMENT',
};

const IOS_DISTRIBUTION_TYPE_BY_ENTERPRISE_PROVISIONING: Record<
  NonNullable<Ios.Job['enterpriseProvisioning']>,
  IosDistributionType
> = {
  adhoc: 'AD_HOC',
  universal: 'ENTERPRISE',
};

interface CheckContext {
  target: IosSigningTarget;
  credentialsTypeLabel: string;
  request: IosSigningRequest;
  now: Date;
}

interface IosBuildCredentialsSelection {
  iosDistributionType: IosDistributionType;
  targets: { target: IosSigningTarget; appleAppIdentifierId: string }[];
}

export function selectStoredIosBuildCredentials(
  targets: IosSigningTarget[],
  storedAppCredentials: StoredIosAppCredentials[],
  request: IosSigningRequest
): IosBuildCredentialsSelection {
  const { selectableCredentialsTypes } = getUsableIosDistributionTypes(request);
  const selectableTypesLabel = selectableCredentialsTypes
    .map(type => IOS_DISTRIBUTION_TYPE_LABELS[type])
    .join(' or ');
  const problems: string[] = [];
  const selections = targets.flatMap(target => {
    const stored = storedAppCredentials.find(
      ({ bundleIdentifier }) => bundleIdentifier === target.bundleIdentifier
    );
    const storedSelectableTypes = selectableCredentialsTypes.filter(type =>
      stored?.iosDistributionTypes.includes(type)
    );
    if (!stored || storedSelectableTypes.length === 0) {
      problems.push(
        `No ${selectableTypesLabel} credentials are stored for ${describeTarget(target)}. A build with ${describeRequest(request)} needs ${selectableTypesLabel} credentials: a distribution certificate and a provisioning profile. Add them on ${CREDENTIALS_PAGE}.`
      );
      return [];
    }
    if (storedSelectableTypes.length > 1) {
      problems.push(
        `Both ${storedSelectableTypes.map(type => IOS_DISTRIBUTION_TYPE_LABELS[type]).join(' and ')} credentials are stored for ${describeTarget(target)}. Set "enterprise_provisioning" to "adhoc" or "universal" in the params of the build job to choose the credentials that sign the build.`
      );
      return [];
    }
    const [iosDistributionType] = storedSelectableTypes;
    return [{ target, appleAppIdentifierId: stored.appleAppIdentifierId, iosDistributionType }];
  });
  if (problems.length > 0) {
    throw new UserError(ERROR_CODE, problems.join('\n'));
  }
  const iosDistributionTypes = new Set(selections.map(selection => selection.iosDistributionType));
  if (iosDistributionTypes.size > 1) {
    throw new UserError(
      ERROR_CODE,
      `The targets of this build have credentials of different types: ${selections
        .map(
          selection =>
            `${IOS_DISTRIBUTION_TYPE_LABELS[selection.iosDistributionType]} for ${describeTarget(selection.target)}`
        )
        .join(
          ', '
        )}. EAS signs all targets of a build with one type. Set "enterprise_provisioning" to "adhoc" or "universal" in the params of the build job, and add credentials of that type for each bundle identifier on ${CREDENTIALS_PAGE}.`
    );
  }
  const [iosDistributionType] = iosDistributionTypes;
  return {
    iosDistributionType,
    targets: selections.map(({ target, appleAppIdentifierId }) => ({
      target,
      appleAppIdentifierId,
    })),
  };
}

export function validateStoredIosBuildCredentials(
  targetsWithBuildCredentials: {
    target: IosSigningTarget;
    buildCredentials: StoredIosBuildCredentials;
  }[],
  {
    iosDistributionType,
    request,
    now,
  }: { iosDistributionType: IosDistributionType; request: IosSigningRequest; now: Date }
): Ios.BuildCredentials {
  const credentialsTypeLabel = IOS_DISTRIBUTION_TYPE_LABELS[iosDistributionType];
  const problems: string[] = [];
  const entries = targetsWithBuildCredentials.flatMap(({ target, buildCredentials }) => {
    const { distributionCertificate, provisioningProfileBase64 } = buildCredentials;
    if (!distributionCertificate?.dataBase64 || !provisioningProfileBase64) {
      const missingParts = [
        ...(distributionCertificate?.dataBase64 ? [] : ['distribution certificate']),
        ...(provisioningProfileBase64 ? [] : ['provisioning profile']),
      ];
      problems.push(
        `The ${credentialsTypeLabel} credentials stored for ${describeTarget(target)} have no ${missingParts.join(' and no ')}. Complete the credentials on ${CREDENTIALS_PAGE}.`
      );
      return [];
    }
    const context = { target, credentialsTypeLabel, request, now };
    problems.push(
      ...[
        findDistributionCertificateProblem(distributionCertificate, context),
        findProvisioningProfileProblem(provisioningProfileBase64, context),
      ].filter(problem => problem !== undefined)
    );
    const targetCredentials: Ios.TargetCredentials = {
      provisioningProfileBase64,
      distributionCertificate: {
        dataBase64: distributionCertificate.dataBase64,
        password: distributionCertificate.password ?? '',
      },
    };
    return [[target.name, targetCredentials] as const];
  });
  if (problems.length > 0) {
    throw new UserError(ERROR_CODE, problems.join('\n'));
  }
  return Object.fromEntries(entries);
}

function getUsableIosDistributionTypes({
  distribution,
  enterpriseProvisioning,
}: IosSigningRequest): {
  selectableCredentialsTypes: IosDistributionType[];
  acceptedProfileTypes: IosDistributionType[];
} {
  switch (distribution) {
    case 'store':
      return {
        selectableCredentialsTypes: ['APP_STORE'],
        acceptedProfileTypes: ['APP_STORE', 'ENTERPRISE'],
      };
    case 'internal': {
      if (enterpriseProvisioning) {
        const type = IOS_DISTRIBUTION_TYPE_BY_ENTERPRISE_PROVISIONING[enterpriseProvisioning];
        return { selectableCredentialsTypes: [type], acceptedProfileTypes: [type] };
      }
      return {
        selectableCredentialsTypes: ['AD_HOC', 'ENTERPRISE'],
        acceptedProfileTypes: ['AD_HOC', 'ENTERPRISE', 'DEVELOPMENT'],
      };
    }
    default:
      throw new Error(`Unexpected distribution: ${distribution satisfies never}`);
  }
}

function findDistributionCertificateProblem(
  { validityNotBefore, validityNotAfter }: { validityNotBefore: Date; validityNotAfter: Date },
  { target, credentialsTypeLabel, now }: CheckContext
): string | undefined {
  const subject = `The distribution certificate of the ${credentialsTypeLabel} credentials for ${describeTarget(target)}`;
  if (now < validityNotBefore) {
    return `${subject} is not valid until ${formatDate(validityNotBefore)}. Upload a distribution certificate that is valid now, and a provisioning profile made with it, on ${CREDENTIALS_PAGE}.`;
  }
  if (now >= validityNotAfter) {
    return `${subject} expired on ${formatDate(validityNotAfter)}. Upload a new distribution certificate, and a provisioning profile made with it, on ${CREDENTIALS_PAGE}.`;
  }
  return undefined;
}

function findProvisioningProfileProblem(
  provisioningProfileBase64: string,
  { target, credentialsTypeLabel, request, now }: CheckContext
): string | undefined {
  const profile = parseProvisioningProfile(provisioningProfileBase64);
  if (!profile) {
    return `EAS could not read the ${credentialsTypeLabel} provisioning profile stored for ${describeTarget(target)}. Upload the provisioning profile again on ${CREDENTIALS_PAGE}.`;
  }
  const { acceptedProfileTypes } = getUsableIosDistributionTypes(request);
  if (!acceptedProfileTypes.includes(profile.type)) {
    return `The provisioning profile of the ${credentialsTypeLabel} credentials for ${describeTarget(target)} has the type "${IOS_DISTRIBUTION_TYPE_LABELS[profile.type]}". A build with ${describeRequest(request)} cannot use a provisioning profile of that type. Upload a provisioning profile of the type "${credentialsTypeLabel}" on ${CREDENTIALS_PAGE}.`;
  }
  if (profile.expirationDate <= now) {
    return `The ${credentialsTypeLabel} provisioning profile for ${describeTarget(target)} expired on ${formatDate(profile.expirationDate)}. Upload a new provisioning profile on ${CREDENTIALS_PAGE}.`;
  }
  const { bundleIdentifierPattern } = profile;
  const isForTarget = bundleIdentifierPattern.endsWith('*')
    ? target.bundleIdentifier.startsWith(bundleIdentifierPattern.slice(0, -1))
    : bundleIdentifierPattern === target.bundleIdentifier;
  if (!isForTarget) {
    return `The ${credentialsTypeLabel} provisioning profile stored for ${describeTarget(target)} is for the bundle identifier "${bundleIdentifierPattern}". Upload a provisioning profile for "${target.bundleIdentifier}" on ${CREDENTIALS_PAGE}.`;
  }
  return undefined;
}

function parseProvisioningProfile(
  provisioningProfileBase64: string
):
  | { bundleIdentifierPattern: string; expirationDate: Date; type: IosDistributionType }
  | undefined {
  let profilePlist;
  try {
    profilePlist = plist.parse(Buffer.from(provisioningProfileBase64, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
  const applicationIdentifier = profilePlist?.Entitlements?.['application-identifier'];
  const expirationDate = profilePlist?.ExpirationDate;
  if (
    typeof applicationIdentifier !== 'string' ||
    !(expirationDate instanceof Date) ||
    Number.isNaN(expirationDate.getTime())
  ) {
    return undefined;
  }
  // Apple's format is "<team ID>.<bundle identifier>"; a wildcard profile ends with "*".
  return {
    bundleIdentifierPattern: applicationIdentifier.replace(/^.+?\./, ''),
    expirationDate,
    type: IOS_DISTRIBUTION_TYPE_BY_PROFILE_TYPE[resolveDistributionType(profilePlist)],
  };
}

function describeTarget({ name, bundleIdentifier }: IosSigningTarget): string {
  return `the bundle identifier "${bundleIdentifier}" (target "${name}")`;
}

function describeRequest({ distribution, enterpriseProvisioning }: IosSigningRequest): string {
  return enterpriseProvisioning
    ? `distribution "${distribution}" and enterprise_provisioning "${enterpriseProvisioning}"`
    : `distribution "${distribution}"`;
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', { timeZone: 'UTC', timeZoneName: 'short' });
}
