import { z } from 'zod';

/** Submission config as used by the submission worker. */
export namespace SubmissionConfig {
  export type Ios = z.infer<typeof Ios.SchemaZ>;
  export type Android = z.infer<typeof Android.SchemaZ>;

  export namespace Ios {
    export const SchemaZ = z
      .object({
        /**
         * App Store Connect unique App ID
         */
        ascAppIdentifier: z.string(),
        isVerboseFastlaneEnabled: z.boolean().optional(),
        groups: z.array(z.string()).optional(),
        changelog: z.string().optional(),
      })
      .and(
        z.union([
          z.object({
            // The `appleIdUsername` & `appleAppSpecificPassword` pair is mutually exclusive with `ascApiJsonKey`
            appleIdUsername: z.string(),
            appleAppSpecificPassword: z.string(),
            ascApiJsonKey: z.never().optional(),
          }),
          z.object({
            /**
             * ASC API JSON token example:
             * {
             *  key_id: "D383SF739",
             *  issuer_id: "6053b7fe-68a8-4acb-89be-165aa6465141",
             *  key: "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM\n-----END PRIVATE KEY--"
             * }
             */
            ascApiJsonKey: z.string(),
            appleIdUsername: z.never().optional(),
            appleAppSpecificPassword: z.never().optional(),
          }),
        ])
      );
  }

  export namespace Android {
    export enum ReleaseStatus {
      COMPLETED = 'completed',
      DRAFT = 'draft',
      HALTED = 'halted',
      IN_PROGRESS = 'inProgress',
    }

    export const SchemaZ = z
      .object({
        track: z.string(),
        changesNotSentForReview: z.boolean().default(false),
        googleServiceAccountKeyJson: z.string(),
        isVerboseFastlaneEnabled: z.boolean().optional(),
        changelog: z.string().optional(),
      })
      .and(
        z.union([
          z.object({
            releaseStatus: z.literal(ReleaseStatus.IN_PROGRESS),
            rollout: z.number().gte(0).lte(1).default(1),
          }),
          z.object({
            releaseStatus: z.nativeEnum(ReleaseStatus).optional(),
            rollout: z.never().optional(),
          }),
        ])
      );
  }
}
