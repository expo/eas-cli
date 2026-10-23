import { type ChildProcessHandle, commands } from './processes';

export function startServeSim(udid: string, signal: AbortSignal): ChildProcessHandle {
  signal.throwIfAborted();
  return commands.start('bunx', [
    `@expo/serve-sim@${process.env.SERVE_SIM_VERSION || 'latest'}`,
    udid,
    '--host',
    '127.0.0.1',
    '--port',
    '3200',
    '--require-token',
    '--transport',
    'webrtc',
    '--webrtc-codec',
    'h264',
    '--max-dimension',
    '1600',
    '--mjpeg-quality',
    '0.55',
    '--video-bitrate',
    '10000000',
    '--video-fps',
    '60',
    '--disable-share',
    '--quiet',
  ]);
}
