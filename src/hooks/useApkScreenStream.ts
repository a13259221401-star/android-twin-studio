import { useEffect, useRef, useState } from 'react';
import { createScreenCanvas, drawContainedFrame, drawStatus, type ScreenStreamStatus } from './screenCanvas';

export type ApkScreenStatus = ScreenStreamStatus;

interface VideoConfigMessage {
  type: 'video-config';
  codec: string;
  width: number;
  height: number;
  fps: number;
}

export function useApkScreenStream(onStatusChange?: (status: ApkScreenStatus) => void, enabled = true) {
  const [canvas] = useState(() => createScreenCanvas('apk'));
  const [status, setStatus] = useState<ApkScreenStatus>('waiting');
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;

  useEffect(() => {
    if (!enabled) {
      drawStatus(canvas, 'waiting', 'apk');
      setStatus('waiting');
      return;
    }
    let currentStatus: ApkScreenStatus = 'waiting';
    const updateStatus = (next: ApkScreenStatus) => {
      if (currentStatus === next) return;
      currentStatus = next;
      if (next !== 'streaming') drawStatus(canvas, next, 'apk');
      setStatus(next);
      statusCallback.current?.(next);
    };

    if (!('VideoDecoder' in window) || !('EncodedVideoChunk' in window)) {
      updateStatus('unsupported');
      return;
    }

    let disposed = false;
    let configured = false;
    let awaitingKeyFrame = true;
    let lastFrameAt = 0;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let frameWatchdog: number | undefined;
    const decoder = new VideoDecoder({
      output: (frame) => {
        lastFrameAt = performance.now();
        try {
          drawContainedFrame(canvas, frame, frame.displayWidth, frame.displayHeight);
          updateStatus('streaming');
        } finally {
          frame.close();
        }
      },
      error: () => {
        awaitingKeyFrame = true;
        updateStatus('error');
      },
    });

    const configure = async (message: VideoConfigMessage) => {
      const support = await VideoDecoder.isConfigSupported({
        codec: message.codec,
        codedWidth: message.width,
        codedHeight: message.height,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware',
      });
      if (!support.supported || !support.config || disposed) {
        updateStatus('unsupported');
        return;
      }
      if (decoder.state !== 'unconfigured') decoder.reset();
      decoder.configure(support.config);
      configured = true;
      awaitingKeyFrame = true;
      updateStatus('connecting');
    };

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/screen/subscribe`);
      socket.binaryType = 'arraybuffer';
      socket.addEventListener('open', () => updateStatus('waiting'));
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data) as VideoConfigMessage | { type: 'video-status'; connected: boolean };
            if (message.type === 'video-config') void configure(message);
            if (message.type === 'video-status' && !message.connected) {
              awaitingKeyFrame = true;
              updateStatus('waiting');
            }
            if (message.type === 'video-status' && message.connected) updateStatus('connecting');
          } catch {
            updateStatus('error');
          }
          return;
        }

        if (!(event.data instanceof ArrayBuffer) || !configured || decoder.state !== 'configured') return;
        const packet = event.data;
        if (packet.byteLength <= 16) return;
        const view = new DataView(packet);
        if (view.getUint8(0) !== 77 || view.getUint8(1) !== 67 || view.getUint8(2) !== 83 || view.getUint8(3) !== 86) return;
        const keyFrame = (view.getUint8(5) & 1) === 1;
        if (awaitingKeyFrame && !keyFrame) return;
        if (keyFrame) awaitingKeyFrame = false;
        if (decoder.decodeQueueSize > 6 && !keyFrame) return;
        const timestamp = Number(view.getBigUint64(8, false));
        try {
          decoder.decode(new EncodedVideoChunk({
            type: keyFrame ? 'key' : 'delta',
            timestamp,
            data: new Uint8Array(packet, 16),
          }));
        } catch {
          awaitingKeyFrame = true;
          updateStatus('connecting');
        }
      });
      socket.addEventListener('close', () => {
        if (disposed) return;
        configured = false;
        awaitingKeyFrame = true;
        updateStatus('waiting');
        reconnectTimer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => updateStatus('error'));
    };

    frameWatchdog = window.setInterval(() => {
      if (lastFrameAt > 0 && performance.now() - lastFrameAt > 1800) {
        awaitingKeyFrame = true;
        lastFrameAt = 0;
        updateStatus('waiting');
      }
    }, 600);

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(frameWatchdog);
      socket?.close();
      decoder.close();
    };
  }, [canvas, enabled]);

  return { canvas, status };
}
