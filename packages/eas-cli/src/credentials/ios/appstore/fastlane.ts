const travelingFastlane = {
  appProduce: 'app_produce',
  authenticate: 'authenticate',
  ensureAppExists: 'ensure_app_exists',
  listDevices: 'list_devices',
  manageAdHocProvisioningProfile: 'manage_ad_hoc_provisioning_profile',
  manageDistCerts: 'manage_dist_certs',
  managePushKeys: 'manage_push_keys',
  manageProvisioningProfiles: 'manage_provisioning_profiles',
  newManageProvisioningProfiles: 'new_manage_provisioning_profiles',
  pilotUpload: 'pilot_upload',
  resolveItcTeamId: 'resolve_itc_team_id',
  supplyAndroid: 'supply_android',
};

const WSL_BASH_PATH = 'C:\\Windows\\system32\\bash.exe';

type Options = {
  pipeStdout?: boolean;
};

async function runActionAsync(
  fastlaneAction: string,
  _args: string[],
  _options: Options = {}
): Promise<any> {
  throw new Error(`Fastlane not available. (Action: ${fastlaneAction}`);
}

export { travelingFastlane, runActionAsync, WSL_BASH_PATH };
