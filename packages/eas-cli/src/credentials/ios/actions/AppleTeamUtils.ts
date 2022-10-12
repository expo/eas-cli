import { AppleTeamFragment } from '../../../graphql/generated';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export async function resolveAppleTeamIfAuthenticatedAsync(
  ctx: CredentialsContext,
  app: AppLookupParams
): Promise<AppleTeamFragment | null> {
  if (!ctx.appStore.authCtx) {
    return null;
  }
  return await ctx.ios.createOrGetExistingAppleTeamAsync(ctx.graphqlClient, app.account, {
    appleTeamIdentifier: ctx.appStore.authCtx.team.id,
    appleTeamName: ctx.appStore.authCtx.team.name,
  });
}
