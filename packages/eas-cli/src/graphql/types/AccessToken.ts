import { Actor } from './Actor';

export interface AccessToken {
  id: string;
  visibleTokenPrefix: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
  owner: Actor;
  note?: string;
}
