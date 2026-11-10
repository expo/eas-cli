import { Socket } from 'node:net';

import { ControlConnectionChannel, MAX_CONTROL_FRAME_BYTES } from '../controlConnectionProtocol';

describe('local control protocol', () => {
  let socket: Socket;
  let channel: ControlConnectionChannel;

  beforeEach(() => {
    socket = new Socket();
    channel = new ControlConnectionChannel(socket);
  });

  afterEach(() => {
    channel.destroy();
  });

  it('decodes fragmented UTF-8 and returns queued replies in order', async () => {
    const bytes = Buffer.from(JSON.stringify({ text: 'héllo' }) + '\n{"id":2}\n');
    const split = bytes.indexOf(Buffer.from('é')) + 1;
    socket.emit('data', bytes.subarray(0, split));
    socket.emit('data', bytes.subarray(split));
    await expect(channel.readAsync()).resolves.toEqual({ text: 'héllo' });
    await expect(channel.readAsync()).resolves.toEqual({ id: 2 });
  });

  it('rejects overlapping reads without replacing the first reader', async () => {
    const pending = channel.readAsync();
    await expect(channel.readAsync()).rejects.toThrow('already pending');
    socket.emit('data', Buffer.from('{"id":1}\n'));
    await expect(pending).resolves.toEqual({ id: 1 });
  });

  it.each(['not-json\n', '{}\n'.repeat(9)])(
    'discards malformed or excessive queued input',
    async input => {
      socket.emit('data', Buffer.from(input));
      await expect(channel.readAsync()).rejects.toThrow('Invalid or oversized');
      await expect(channel.writeAsync({ id: 1 })).rejects.toThrow('Invalid or oversized');
      expect(socket.destroyed).toBe(true);
    }
  );

  it('rejects an oversized incoming frame before parsing it', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 'x');
    for (let bytes = 0; bytes <= MAX_CONTROL_FRAME_BYTES; bytes += chunk.length) {
      socket.emit('data', chunk);
    }
    await expect(channel.readAsync()).rejects.toThrow('Invalid or oversized');
    expect(socket.destroyed).toBe(true);
  });

  it('rejects an oversized outgoing frame without writing it', async () => {
    const write = jest.spyOn(socket, 'write');
    await expect(channel.writeAsync('x'.repeat(MAX_CONTROL_FRAME_BYTES))).rejects.toThrow(
      'too large'
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves the first transport error for pending and later reads', async () => {
    const pending = channel.readAsync();
    const rejected = expect(pending).rejects.toThrow('transport failed');
    socket.emit('error', new Error('transport failed'));
    channel.destroy();
    await rejected;
    await expect(channel.readAsync()).rejects.toThrow('transport failed');
  });

  it('propagates write callback failures', async () => {
    await expect(channel.writeAsync({ id: 1 })).rejects.toMatchObject({
      code: 'ERR_SOCKET_CLOSED',
    });
  });
});
