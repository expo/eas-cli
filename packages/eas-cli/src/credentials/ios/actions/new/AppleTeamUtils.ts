import { AppleTeamFragment } from '../../../../graphql/generated';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';

export async function resolveAppleTeamIfAuthenticatedAsync(
  ctx: Context,
  app: AppLookupParams
): Promise<AppleTeamFragment | null> {
  if (!ctx.appStore.authCtx) {
    return null;
  }
  return await ctx.newIos.createOrGetExistingAppleTeamAsync(app, {
    appleTeamIdentifier: ctx.appStore.authCtx.team.id,
    appleTeamName: ctx.appStore.authCtx.team.name,
  });
}
