import { AppleMetadata } from './apple/types';

export interface Metadata {
  /** The store configuration version */
  configVersion: number;
  /** All App Store related configuration */
  apple?: AppleMetadata;
}
