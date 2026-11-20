import { z } from 'zod';

import { DistributionType } from './provisioningProfile';

export const InstalledIosCredentialsZ = z.object({
  keychainPath: z.string(),
  distributionType: z.enum(DistributionType),
  profileByTargetName: z.record(
    z.string(),
    z.object({
      bundleIdentifier: z.string(),
      profileName: z.string(),
      profileUuid: z.string(),
      teamId: z.string(),
      certificateCommonName: z.string(),
    })
  ),
});

export type InstalledIosCredentials = z.infer<typeof InstalledIosCredentialsZ>;
