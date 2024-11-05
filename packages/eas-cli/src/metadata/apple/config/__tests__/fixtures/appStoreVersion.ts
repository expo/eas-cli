import {
  AppStoreState,
  AppStoreVersion,
  AppVersionState,
  Platform,
  ReleaseType,
  ReviewType,
} from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

export const manualRelease: AttributesOf<AppStoreVersion> = {
  platform: Platform.IOS,
  versionString: '1.0.0',
  appStoreState: AppStoreState.WAITING_FOR_REVIEW,
  appVersionState: AppVersionState.WAITING_FOR_REVIEW,
  storeIcon: null,
  watchStoreIcon: null,
  copyright: '2022 - ACME',
  releaseType: ReleaseType.MANUAL,
  earliestReleaseDate: null,
  downloadable: false,
  createdDate: '2022-05-23T00:00:00.000Z',
  reviewType: ReviewType.APP_STORE,
};

export const automaticRelease: AttributesOf<AppStoreVersion> = {
  platform: Platform.IOS,
  versionString: '2.0.0',
  appStoreState: AppStoreState.WAITING_FOR_REVIEW,
  appVersionState: AppVersionState.WAITING_FOR_REVIEW,
  storeIcon: null,
  watchStoreIcon: null,
  copyright: '2022 - ACME',
  releaseType: ReleaseType.AFTER_APPROVAL,
  earliestReleaseDate: null,
  downloadable: false,
  createdDate: '2022-05-23T00:00:00.000Z',
  reviewType: ReviewType.APP_STORE,
};

export const scheduledRelease: AttributesOf<AppStoreVersion> = {
  platform: Platform.IOS,
  versionString: '3.0.0',
  appStoreState: AppStoreState.READY_FOR_SALE,
  appVersionState: AppVersionState.ACCEPTED,
  storeIcon: null,
  watchStoreIcon: null,
  copyright: '2022 - ACME',
  releaseType: ReleaseType.SCHEDULED,
  earliestReleaseDate: '2022-05-29T00:00:00.000Z',
  downloadable: false,
  createdDate: '2022-05-23T00:00:00.000Z',
  reviewType: ReviewType.APP_STORE,
};
