import { AccessToken } from './AccessToken';
import { Account } from './Account';

export interface Actor {
  id: string;
  firstName?: string;
  created?: Date;
  isExpoAdmin?: boolean;
  accounts?: Account[];
  accessTokens?: AccessToken[];
}
