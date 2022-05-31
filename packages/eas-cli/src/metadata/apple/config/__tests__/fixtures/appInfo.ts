import { AppCategory, AppInfo, BundleIdPlatform } from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

export const primaryOnlyCategory: Pick<AttributesOf<AppInfo>, 'primaryCategory'> = {
  primaryCategory: new AppCategory({} as any, 'ENTERTAINMENT', {
    platforms: [BundleIdPlatform.IOS, BundleIdPlatform.MAC_OS],
  }),
};

export const secondaryOnlyCategory: Pick<AttributesOf<AppInfo>, 'secondaryCategory'> = {
  secondaryCategory: new AppCategory({} as any, 'GAMES', {
    platforms: [BundleIdPlatform.IOS, BundleIdPlatform.MAC_OS],
  }),
};

export const primaryAndSecondaryCategory: Pick<
  AttributesOf<AppInfo>,
  'primaryCategory' | 'secondaryCategory'
> = {
  ...primaryOnlyCategory,
  ...secondaryOnlyCategory,
};
