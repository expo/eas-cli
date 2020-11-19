import { User } from './User';
import { AppleDistributionCertificate } from './credentials/AppleDistributionCertificate';

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
  appleDistributionCertificates?: AppleDistributionCertificate[];
}
