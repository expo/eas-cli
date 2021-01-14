import { JSONValue } from '@expo/json-file';
import { HTTPError, RequestError } from 'got/dist/source';

export default class ApiV2Error extends RequestError {
  readonly name = 'ApiV2Error';
  readonly expoApiV2ErrorCode: string;
  readonly expoApiV2ErrorDetails?: JSONValue;
  readonly expoApiV2ErrorServerStack?: string;
  readonly expoApiV2ErrorMetadata?: object;

  constructor(
    originalError: HTTPError,
    response: {
      message: string;
      code: string;
      stack?: string;
      details?: JSONValue;
      metadata?: object;
    }
  ) {
    super(response.message, originalError, originalError.request);
    this.expoApiV2ErrorCode = response.code;
    this.expoApiV2ErrorDetails = response.details;
    this.expoApiV2ErrorServerStack = response.stack;
    this.expoApiV2ErrorMetadata = response.metadata;
  }
}
