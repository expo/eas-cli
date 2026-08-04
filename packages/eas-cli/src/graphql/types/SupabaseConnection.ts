import gql from 'graphql-tag';

import {
  SupabaseConnection,
  SupabaseOAuthStart,
  SupabaseOrganization,
  SupabaseProject,
} from '../generated';

export {
  BeginSupabaseOAuthInput,
  LinkSupabaseProjectInput,
  ProvisionAdditionalSupabaseProjectInput,
  ProvisionSupabaseProjectInput,
  SetSupabaseConnectionOrganizationInput,
} from '../generated';

export type SupabaseOrganizationData = Pick<SupabaseOrganization, 'id' | 'slug' | 'name'>;

export type SupabaseConnectionData = Pick<
  SupabaseConnection,
  'id' | 'supabaseOrganizationSlug' | 'supabaseOrganizationName' | 'createdAt' | 'updatedAt'
>;

export type SupabaseProjectData = Pick<
  SupabaseProject,
  | 'id'
  | 'supabaseProjectRef'
  | 'supabaseProjectName'
  | 'supabaseProjectUrl'
  | 'supabaseRegion'
  | 'createdAt'
  | 'updatedAt'
>;

export type SupabaseOAuthStartData = Pick<SupabaseOAuthStart, 'url'>;

export const SupabaseConnectionFragmentNode = gql`
  fragment SupabaseConnectionFragment on SupabaseConnection {
    id
    supabaseOrganizationSlug
    supabaseOrganizationName
    createdAt
    updatedAt
  }
`;

export const SupabaseProjectFragmentNode = gql`
  fragment SupabaseProjectFragment on SupabaseProject {
    id
    supabaseProjectRef
    supabaseProjectName
    supabaseProjectUrl
    supabaseRegion
    createdAt
    updatedAt
  }
`;
