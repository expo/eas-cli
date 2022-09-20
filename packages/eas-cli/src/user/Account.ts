import { Account as GraphQLAccount } from '../graphql/generated';

export type Account = Pick<GraphQLAccount, 'id' | 'name'>;
