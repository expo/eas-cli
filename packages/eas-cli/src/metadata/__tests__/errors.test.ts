import {
  MetadataDownloadError,
  MetadataUploadError,
  MetadataValidationError,
  handleMetadataError,
} from '../errors';

jest.mock('../../log');

describe(handleMetadataError, () => {
  it('re-throws a generic error untouched', () => {
    const original = new Error('something exploded');

    expect(() => {
      handleMetadataError(original);
    }).toThrow(original);
  });

  it('re-throws a MetadataValidationError so the command exits with non-zero status', () => {
    const validation = new MetadataValidationError('validation failed', []);

    expect(() => {
      handleMetadataError(validation);
    }).toThrow(validation);
  });

  it('re-throws a MetadataUploadError so the command exits with non-zero status', () => {
    const uploadError = new MetadataUploadError(
      [new Error('Failed uploading 01.png'), new Error('Failed uploading 02.png')],
      'exec-1'
    );

    expect(() => {
      handleMetadataError(uploadError);
    }).toThrow(uploadError);
  });

  it('re-throws a MetadataDownloadError so the command exits with non-zero status', () => {
    const downloadError = new MetadataDownloadError(
      [new Error('Failed downloading screenshot.png')],
      'exec-2'
    );

    expect(() => {
      handleMetadataError(downloadError);
    }).toThrow(downloadError);
  });
});
