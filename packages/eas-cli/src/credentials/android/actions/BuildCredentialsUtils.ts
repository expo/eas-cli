import { getProjectAccountName, getProjectConfigDescription } from '../../../project/projectUtils';
import { findAccountByName } from '../../../user/Account';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

export function getAppLookupParamsFromContext(ctx: Context): AppLookupParams {
  ctx.ensureProjectContext();
  const projectName = ctx.exp.slug;
  const accountName = getProjectAccountName(ctx.exp, ctx.user);
  const account = findAccountByName(ctx.user.accounts, accountName);
  if (!account) {
    throw new Error(`You do not have access to account: ${accountName}`);
  }

  const androidApplicationIdentifier = ctx.exp.android?.package;
  if (!androidApplicationIdentifier) {
    throw new Error(
      `android.package needs to be defined in your ${getProjectConfigDescription(
        ctx.projectDir
      )} file`
    );
  }

  return { account, projectName, androidApplicationIdentifier };
}
