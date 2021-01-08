import { DocumentNode } from 'graphql';

export interface Fragment {
  name: string;
  definition: DocumentNode;
}
