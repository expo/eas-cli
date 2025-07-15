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

async function* createReadStreamAsync(filePath: string): AsyncGenerator<Uint8Array> {
  const handle = await fs.promises.open(filePath);
  const buffer = Buffer.alloc(4096);
  try {
    let bytesRead = 0;
    while ((bytesRead = (await handle.read(buffer)).bytesRead) > 0)
      yield new Uint8Array(buffer, buffer.byteOffset, bytesRead);
  } finally {
    await handle.close();
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
  name: string;
  filePath: string;
  contentType: string | null;
  contentLength: number | null;
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
      name: entry.name,
      contentType: entry.contentType,
      contentLength: entry.contentLength,
    });
    yield encoder.encode(header);
    yield* createReadStreamAsync(entry.filePath);
    yield encoder.encode(CRLF);
    if (onProgressUpdate) {
      onProgressUpdate((idx + 1) / entries.length);
    }
  }
  yield encoder.encode(FORM_FOOTER);
}
