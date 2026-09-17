import { UploadSessionType } from './generated';

/**
 * Temporary stand-ins for GraphQL types that the schema does not expose yet.
 *
 * TODO(ENG-26889): delete this file once https://github.com/expo/universe/pull/30154 is deployed
 * and `yarn generate-graphql-code` has run. Replace each import of these symbols with the generated
 * `SourceMapSourceType`, `SourceMapSourceInput`, `SourceMapGroup` and
 * `UploadSessionType.EasUpdateSourceMaps`. Grep for ENG-26889 to find every site to update.
 */
export enum SourceMapSourceType {
  Gcs = 'GCS',
}

export type SourceMapSourceInput = {
  type: SourceMapSourceType;
  bucketKey: string;
};

export type SourceMapGroup = {
  android?: SourceMapSourceInput;
  ios?: SourceMapSourceInput;
};

export const UPLOAD_SESSION_TYPE_EAS_UPDATE_SOURCE_MAPS =
  'EAS_UPDATE_SOURCE_MAPS' as UploadSessionType;
