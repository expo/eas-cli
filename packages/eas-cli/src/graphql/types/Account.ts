import { User } from './User';

export interface Account {
  id: string;
  name: string;
  isCurrent?: boolean;
  unlimitedAccess?: boolean;
  subscriptionChangesPending?: boolean;
  pushSecurityEnabled?: boolean;
  createdAt: Date;
  updatedAt: Date;
  owner?: User;
  //...
}
