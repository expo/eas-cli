import plist, { PlistArray, PlistObject } from '@expo/plist';

interface AppleTeam {
  teamId: string;
  teamName: string;
}

export function readAppleTeam(dataBase64: string): AppleTeam {
  const profilePlist = parse(dataBase64);
  const teamId = (profilePlist['TeamIdentifier'] as PlistArray)?.[0] as string;
  const teamName = profilePlist['TeamName'] as string;
  if (!teamId) {
    throw new Error('Team identifier is missing from provisioning profile');
  }
  return { teamId, teamName };
}

export function readProfileName(dataBase64: string): string {
  const profilePlist = parse(dataBase64);
  return profilePlist['Name'] as string;
}

export function isAdHocProfile(dataBase64: string): boolean {
  const profilePlist = parse(dataBase64);
  const provisionedDevices = profilePlist['ProvisionedDevices'] as string[] | undefined;
  return Array.isArray(provisionedDevices);
}

export function isEnterpriseUniversalProfile(dataBase64: string): boolean {
  const profilePlist = parse(dataBase64);
  return !!profilePlist['ProvisionsAllDevices'];
}

export function parse(dataBase64: string): PlistObject {
  try {
    const buffer = Buffer.from(dataBase64, 'base64');
    const profile = buffer.toString('utf8');
    return plist.parse(profile) as PlistObject;
  } catch {
    throw new Error('Provisioning profile is malformed');
  }
}
