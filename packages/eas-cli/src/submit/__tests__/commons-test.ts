import { Platform } from '@expo/eas-build-job';
import {
  AndroidReleaseStatus,
  AndroidReleaseTrack,
  EasJsonAccessor,
  EasJsonUtils,
} from '@expo/eas-json';
import { MissingProfileError } from '@expo/eas-json/build/errors';

import { refreshContextSubmitProfileAsync } from '../commons';
import { SubmissionContext } from '../context';

jest.mock('@expo/eas-json');

describe(refreshContextSubmitProfileAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('iOS', () => {
    it('returns updated context if profile exists', async () => {
      const submitContext = {
        profile: { language: 'pl-PL' },
      } as any as SubmissionContext<Platform.IOS>;
      jest
        .mocked(EasJsonUtils.getSubmitProfileAsync)
        .mockImplementation(
          async (
            _accessor: EasJsonAccessor,
            _platform: Platform,
            _profileName: string | undefined
          ) => {
            return { language: 'en-US' };
          }
        );

      const result = await refreshContextSubmitProfileAsync(submitContext, 'existingProfile');

      expect(result).toEqual({ profile: { language: 'en-US' } });
    });
    it('returns unmodified context if profile does not exist', async () => {
      const submitContext = {
        profile: { language: 'pl-PL' },
      } as any as SubmissionContext<Platform.IOS>;
      jest
        .mocked(EasJsonUtils.getSubmitProfileAsync)
        .mockImplementation(
          async (
            _accessor: EasJsonAccessor,
            _platform: Platform,
            profileName: string | undefined
          ) => {
            throw new MissingProfileError(`Missing submit profile in eas.json: ${profileName}`);
          }
        );

      const result = await refreshContextSubmitProfileAsync(submitContext, 'nonExistingProfile');

      expect(result).toEqual({ profile: { language: 'pl-PL' } });
    });
  });

  describe('Android', () => {
    it('returns updated context if profile exists', async () => {
      const submitContext = {
        profile: {
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
          applicationId: 'appId1',
        },
      } as any as SubmissionContext<Platform.ANDROID>;
      jest
        .mocked(EasJsonUtils.getSubmitProfileAsync)
        .mockImplementation(
          async (
            _accessor: EasJsonAccessor,
            _platform: Platform,
            _profileName: string | undefined
          ) => {
            return {
              track: AndroidReleaseTrack.beta,
              releaseStatus: AndroidReleaseStatus.inProgress,
              changesNotSentForReview: true,
              applicationId: 'appId2',
            };
          }
        );

      const result = await refreshContextSubmitProfileAsync(submitContext, 'existingProfile');

      expect(result).toEqual({
        profile: {
          track: AndroidReleaseTrack.beta,
          releaseStatus: AndroidReleaseStatus.inProgress,
          changesNotSentForReview: true,
          applicationId: 'appId2',
        },
      });
    });
    it('returns unmodified context if profile does not exist', async () => {
      const submitContext = {
        profile: {
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
          applicationId: 'appId1',
        },
      } as any as SubmissionContext<Platform.ANDROID>;
      jest
        .mocked(EasJsonUtils.getSubmitProfileAsync)
        .mockImplementation(
          async (
            _accessor: EasJsonAccessor,
            _platform: Platform,
            profileName: string | undefined
          ) => {
            throw new MissingProfileError(`Missing submit profile in eas.json: ${profileName}`);
          }
        );

      const result = await refreshContextSubmitProfileAsync(submitContext, 'nonExistingProfile');

      expect(result).toEqual({
        profile: {
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
          applicationId: 'appId1',
        },
      });
    });
  });
});
