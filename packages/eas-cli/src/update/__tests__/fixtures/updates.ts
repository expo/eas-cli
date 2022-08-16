import { v4 as uuidv4 } from 'uuid';

import { PublishPlatformFlag } from '../../../commands/update';
import { UpdateObject } from '../../../graphql/queries/UpdateQuery';

export function createMockUpdates(
  {
    updateCount = 1,
    platformFlag = 'all',
    groupId,
  }: Partial<{
    updateCount: number;
    platformFlag: PublishPlatformFlag;
    groupId: string;
  }> = {
    updateCount: 1,
    platformFlag: 'all',
  }
): UpdateObject[] {
  let updates: UpdateObject[] = [];
  if (platformFlag === 'all') {
    updateCount = Math.ceil(updateCount / 2);
  }
  for (let i = 0; i < updateCount; i++) {
    const androidUpdate = {
      id: uuidv4(),
      group: uuidv4(),
      message: 'default test message',
      createdAt: new Date(),
      runtimeVersion: 'exposdk:44.0.0',
      platform: 'android',
      manifestFragment: '',
    };
    const iosUpdate = {
      ...androidUpdate,
      id: uuidv4(),
      platform: 'ios',
    };
    if (!i && groupId) {
      androidUpdate.group = groupId;
      iosUpdate.group = groupId;
    }
    const isOddNumberedUpdateCount = !(updateCount % 2);
    const isFinalLoop = i === updateCount - 1;
    switch (platformFlag) {
      case 'all':
        updates = [
          ...updates,
          androidUpdate as UpdateObject,
          ...(isFinalLoop && isOddNumberedUpdateCount ? [] : [iosUpdate as UpdateObject]),
        ];
        break;
      case 'android':
        updates = [...updates, androidUpdate as UpdateObject];
        break;
      case 'ios':
        updates = [...updates, iosUpdate as UpdateObject];
        break;
    }
  }
  return updates;
}
