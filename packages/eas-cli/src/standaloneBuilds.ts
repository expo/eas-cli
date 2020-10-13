import { Platform } from '@expo/config';

import { apiClient } from './api';
import { ensureLoggedInAsync } from './user/actions';

interface StandaloneBuildParams {
  platform: Platform;
  id?: string;
  slug: string;
  owner?: string;
}

export type Build = any;

// Legacy Turtle v1 builds
export async function getStandaloneBuilds(
  { platform, slug, owner, id }: StandaloneBuildParams,
  limit?: number
): Promise<Build[]> {
  await ensureLoggedInAsync();
  const { data } = await apiClient
    .get('standalone-build/get', {
      searchParams: {
        id,
        slug,
        platform,
        limit,
        status: 'finished',
        owner,
      },
    })
    .json();
  return data.builds;
}

export async function getStandaloneBuildById(queryParams: StandaloneBuildParams): Promise<Build> {
  const builds = await getStandaloneBuilds(queryParams, 1);
  if (builds.length === 0) {
    return null;
  } else {
    return builds[0];
  }
}
