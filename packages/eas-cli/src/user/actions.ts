import { Actor } from './User';
import { AccountFragment } from '../graphql/generated';

export function ensureActorHasPrimaryAccount(user: Actor): AccountFragment {
  if (user.__typename === 'User' || user.__typename === 'SSOUser') {
    return user.primaryAccount;
  }
  throw new Error('This action is not supported for robot users.');
}
