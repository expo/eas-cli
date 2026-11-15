import { ArchiveSourceType } from '@expo/eas-build-job';
import { z } from 'zod';

export const ProjectArchiveSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(ArchiveSourceType.GIT),
    repositoryUrl: z.string().url(),
    gitRef: z.string().nullable(),
    gitCommitHash: z.string(),
  }),
  z.object({ type: z.literal(ArchiveSourceType.URL), url: z.string().url() }),
  z.object({ type: z.literal(ArchiveSourceType.NONE) }),
]);

export type ProjectArchiveSource = z.infer<typeof ProjectArchiveSourceSchema>;
