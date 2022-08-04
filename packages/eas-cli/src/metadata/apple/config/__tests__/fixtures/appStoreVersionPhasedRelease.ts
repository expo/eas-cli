import { AppStoreVersionPhasedRelease, PhasedReleaseState } from '@expo/apple-utils';

import { AttributesOf } from '../../../../utils/asc';

export const phasedRelease: AttributesOf<AppStoreVersionPhasedRelease> = {
  phasedReleaseState: PhasedReleaseState.COMPLETE,
  currentDayNumber: 7,
  startDate: null,
  totalPauseDuration: null,
};
