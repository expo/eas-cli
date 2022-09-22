import { AccountFragment } from '../graphql/generated';
import { Actor } from './User';

export function ensureActorHasPrimaryAccount(user: Actor): AccountFragment {
  if (user.__typename === 'User') {
    return user.primaryAccount;
  }
  throw new Error('This action is not supported for robot users.');
}
