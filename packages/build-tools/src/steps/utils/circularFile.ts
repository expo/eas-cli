import fs from 'node:fs';

export const SERVE_SIM_LOG_MAX_BYTES = 10 * 1024 * 1024;

export class CircularFile {
  private position = 0;
  private size = 0;
  truncated = false;

  constructor(
    readonly filePath: string,
    private readonly capacity = SERVE_SIM_LOG_MAX_BYTES
  ) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error('Circular file capacity must be a positive integer.');
    }
    const fd = fs.openSync(filePath, 'w', 0o600);
    fs.closeSync(fd);
  }

  append(chunk: Buffer): void {
    if (chunk.length === 0) {
      return;
    }
    this.truncated ||= this.size + chunk.length > this.capacity;
    if (chunk.length >= this.capacity) {
      chunk = chunk.subarray(chunk.length - this.capacity);
      this.position = 0;
    }
    const fd = fs.openSync(this.filePath, 'r+');
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(chunk.length - offset, this.capacity - this.position);
        const written = fs.writeSync(fd, chunk, offset, length, this.position);
        if (written === 0) {
          throw new Error('Could not write circular file output.');
        }
        offset += written;
        this.position = (this.position + written) % this.capacity;
      }
      this.size = Math.min(this.capacity, this.size + chunk.length);
    } finally {
      fs.closeSync(fd);
    }
  }

  read(maxBytes = this.capacity): Buffer {
    const length = Math.min(this.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(this.filePath, 'r');
    try {
      let offset = 0;
      let position = (this.position - length + this.capacity) % this.capacity;
      while (offset < length) {
        const bytes = fs.readSync(
          fd,
          buffer,
          offset,
          Math.min(length - offset, this.capacity - position),
          position
        );
        if (bytes === 0) {
          throw new Error('Could not read circular file output.');
        }
        offset += bytes;
        position = (position + bytes) % this.capacity;
      }
      return buffer;
    } finally {
      fs.closeSync(fd);
    }
  }
}
