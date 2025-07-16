import { createHash } from 'node:crypto';
import fs from 'node:fs';

const CRLF = '\r\n';
const BOUNDARY_HYPHEN_CHARS = '--';
const BOUNDARY_ID = '----formdata-eas-cli';
const FORM_FOOTER = `${BOUNDARY_HYPHEN_CHARS}${BOUNDARY_ID}${BOUNDARY_HYPHEN_CHARS}${CRLF}${CRLF}`;

const encodeName = (input: string): string => {
  return input.replace(/["\n\\]/g, (c: string) => {
    switch (c) {
      case '\\':
        return '\\\\';
      case '"':
        return '%22';
      case '\n':
        return '%0A';
      default:
        return `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
    }
  });
};

export async function* createReadStreamAsync(
  fileEntry: MultipartFileEntry
): AsyncGenerator<Uint8Array> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(fileEntry.path);
    const hash = createHash('sha512');
    // NOTE(@kitten): fs.createReadStream() was previously used here as an async iterator
    // However, if an early 'end' event is emitted, the async iterator may abort too early and cut off file contents
    let bytesTotal = 0;
    while (bytesTotal < fileEntry.size) {
      const read = await handle.read();
      const output = read.buffer.subarray(0, read.bytesRead);
      bytesTotal += output.byteLength;

      if (bytesTotal > fileEntry.size) {
        throw new RangeError(
          `Asset "${fileEntry.path}" was modified during the upload (length mismatch)`
        );
      }

      if (output.byteLength) {
        hash.update(output);
      }

      if (bytesTotal === fileEntry.size) {
        const sha512 = hash.digest('hex');
        if (sha512 !== fileEntry.sha512) {
          throw new Error(
            `Asset "${fileEntry.path}" was modified during the upload (checksum mismatch)`
          );
        }
      }

      if (output.byteLength) {
        yield output;
      } else {
        break;
      }
    }

    if (bytesTotal < fileEntry.size) {
      throw new RangeError(
        `Asset "${fileEntry.path}" was modified during the upload (length mismatch)`
      );
    }
  } finally {
    await handle?.close();
  }
}

const makeFormHeader = (params: {
  name: string;
  contentType: string | null;
  contentLength: number | null;
}): string => {
  const name = encodeName(params.name);
  let header = BOUNDARY_HYPHEN_CHARS + BOUNDARY_ID + CRLF;
  header += `Content-Disposition: form-data; name="${name}"; filename="${name}"`;
  if (params.contentType) {
    header += `${CRLF}Content-Type: ${params.contentType}`;
  }
  if (params.contentLength) {
    header += `${CRLF}Content-Length: ${params.contentLength}`;
  }
  header += CRLF;
  header += CRLF;
  return header;
};

export interface MultipartFileEntry {
  sha512: string;
  path: string;
  type: string | null;
  size: number;
}

export const multipartContentType = `multipart/form-data; boundary=${BOUNDARY_ID}`;

type OnProgressUpdateCallback = (progress: number) => void;

export async function* createMultipartBodyFromFilesAsync(
  entries: MultipartFileEntry[],
  onProgressUpdate?: OnProgressUpdateCallback
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const header = makeFormHeader({
      name: entry.sha512,
      contentType: entry.type,
      contentLength: entry.size,
    });
    yield encoder.encode(header);
    yield* createReadStreamAsync(entry);
    yield encoder.encode(CRLF);
    if (onProgressUpdate) {
      onProgressUpdate((idx + 1) / entries.length);
    }
  }
  yield encoder.encode(FORM_FOOTER);
}
