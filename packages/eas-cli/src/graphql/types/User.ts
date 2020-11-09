import { Actor } from './Actor';

export interface User extends Actor {
  id: string;
  username: string;
  email?: string;
  lastName?: string;
  fullName?: string;
  profilePhoto?: string;
  lastLogin?: Date;
  lastPasswordReset?: Date;
  bio?: string;
  industry?: string;
  location?: string;
  appCount?: number;
  githubUsername?: string;
  twitterUsername?: string;
  //...
}
