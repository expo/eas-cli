import { Platform } from '@expo/eas-build-job';

import { isEASUpdateConfigured } from '../../project/projectUtils';
import { BuildContext } from '../context';

export function resolveChannel(ctx: BuildContext<Platform>): string | undefined {
  let fallback: string | undefined = undefined;
  if (isEASUpdateConfigured(ctx.projectDir, ctx.exp)) {
    fallback = ctx.buildProfileName;
  }
  return ctx.buildProfile.channel ?? fallback;
}
