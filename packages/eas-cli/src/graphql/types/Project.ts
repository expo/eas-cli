export interface Project {
  id: string;
  name: string;
  fullName: string;
  description: string;
  slug: string;
  username: string;
  published: boolean;
  updated: Date;

  /** @deprecated No longer supported */
  iconUrl?: string;
}
