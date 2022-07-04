import AppleUtils from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc.js';

const { AppStoreState, Platform, ReleaseType } = AppleUtils;

export const manualRelease: AttributesOf<AppleUtils.AppStoreVersion> = {
  platform: Platform.IOS,
  versionString: '1.0.0',
  appStoreState: AppStoreState.WAITING_FOR_REVIEW,
  storeIcon: null,
  watchStoreIcon: null,
  copyright: '2022 - ACME',
  releaseType: ReleaseType.MANUAL,
  earliestReleaseDate: null,
  usesIdfa: null,
  isWatchOnly: false,
  downloadable: false,
  createdDate: '2022-05-23T00:00:00.000Z',
};

export const automaticRelease: AttributesOf<AppleUtils.AppStoreVersion> = {
  platform: Platform.IOS,
  versionString: '2.0.0',
  appStoreState: AppStoreState.WAITING_FOR_REVIEW,
  storeIcon: null,
  watchStoreIcon: null,
  copyright: '2022 - ACME',
  releaseType: ReleaseType.AFTER_APPROVAL,
  earliestReleaseDate: null,
  usesIdfa: null,
  isWatchOnly: false,
  downloadable: false,
  createdDate: '2022-05-23T00:00:00.000Z',
};

export const scheduledRelease: AttributesOf<AppleUtils.AppStoreVersion> = {
  platform: Platform.IOS,
  versionString: '3.0.0',
  appStoreState: AppStoreState.READY_FOR_SALE,
  storeIcon: null,
  watchStoreIcon: null,
  copyright: '2022 - ACME',
  releaseType: ReleaseType.SCHEDULED,
  earliestReleaseDate: '2022-05-29T00:00:00.000Z',
  usesIdfa: null,
  isWatchOnly: false,
  downloadable: false,
  createdDate: '2022-05-23T00:00:00.000Z',
};
