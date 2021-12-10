import { format } from '@expo/timeago.js';

import { Maybe, Robot, Update, User } from '../graphql/generated';
import { getActorDisplayName } from '../user/User';
import groupBy from '../utils/expodash/groupBy';

export type FormatUpdateParameter = Pick<Update, 'id' | 'createdAt' | 'message'> & {
  actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
};

export const UPDATE_COLUMNS = [
  'Update message',
  'Update runtime version',
  'Update group ID',
  'Update platforms',
];

export function getPlatformsForGroup({
  group,
  updates,
}: {
  group: string;
  updates: { group: string; platform: string }[];
}): string {
  const groupedUpdates = groupBy(updates, update => update.group);
  if (Object.keys(groupedUpdates).length === 0) {
    return 'N/A';
  }
  return groupedUpdates[group]
    .map(update => update.platform)
    .sort()
    .join(', ');
}

export function formatUpdate(update: FormatUpdateParameter): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.message ? `"${update.message}" ` : '';
  return `${message}(${format(update.createdAt, 'en_US')} by ${getActorDisplayName(
    update.actor as any
  )})`;
}
