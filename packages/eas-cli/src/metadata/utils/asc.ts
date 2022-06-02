import { ConnectModel } from '@expo/apple-utils';

/** Get the properties of a single App Store Connect entity */
export type AttributesOf<T extends ConnectModel> = T['attributes'];
