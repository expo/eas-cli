import { ConnectModel } from '@expo/apple-utils';

// TODO: probably export this from the apple-utils library
export type AttributesOf<T extends ConnectModel> = T['attributes'];
