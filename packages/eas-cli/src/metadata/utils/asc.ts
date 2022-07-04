import AppleUtils from '@expo/apple-utils';

/** Get the properties of a single App Store Connect entity */
export type AttributesOf<T extends AppleUtils.ConnectModel> = T['attributes'];
