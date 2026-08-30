import { useEffect, useRef, useState } from 'react';
import { createScreenCanvas, drawContainedFrame, drawStatus, type ScreenStreamStatus } from './screenCanvas';

interface UsbScreenStreamOptions {
  active: boolean;
  deviceId?: string;
  onStatusChange?: (status: ScreenStreamStatus) => void;
}

export function useUsbScreenStream({ active, deviceId, onStatusChange }: UsbScreenStreamOptions) {
  const [canvas] = useState(() => createScreenCanvas('usb'));
  const [status, setStatus] = useState<ScreenStreamStatus>('waiting');
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;

  useEffect(() => {
    let currentStatus: ScreenStreamStatus = 'waiting';
    const updateStatus = (next: ScreenStreamStatus) => {
      if (currentStatus === next) return;
      currentStatus = next;
      if (next !== 'streaming') drawStatus(canvas, next, 'usb');
      setStatus(next);
      statusCallback.current?.(next);
    };

    if (!active || !deviceId) {
      drawStatus(canvas, 'waiting', 'usb');
      setStatus('waiting');
      statusCallback.current?.('waiting');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.title = 'USB Android 视频解码通道';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    Object.assign(iframe.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '360px',
      height: '780px',
      border: '0',
      opacity: '0',
      pointerEvents: 'none',
    });
    const streamUrl = new URL('/mirror-runtime/embed.html', window.location.origin);
    streamUrl.searchParams.set('device', deviceId);
    streamUrl.searchParams.set('codec', 'h264');
    streamUrl.searchParams.set('maxFps', '30');
    streamUrl.searchParams.set('maxSize', '1920');
    streamUrl.searchParams.set('bitrate', '8000000');
    streamUrl.searchParams.set('audio', 'true');
    streamUrl.searchParams.set('keyboard', 'false');
    streamUrl.searchParams.set('deviceKind', 'phone');
    iframe.src = streamUrl.toString();
    document.body.appendChild(iframe);
    updateStatus('connecting');

    let disposed = false;
    let animationFrame = 0;
    let lastPaintAt = 0;
    const paint = (now: number) => {
      if (disposed) return;
      if (now - lastPaintAt >= 1000 / 30) {
        lastPaintAt = now;
        try {
          const document = iframe.contentDocument;
          const source = document?.querySelector<HTMLCanvasElement>('canvas.video-layer');
          const runtimeStatus = document?.querySelector<HTMLElement>('#status')?.textContent || '';
          if (source && source.width > 0 && source.height > 0 && /^connected\b/i.test(runtimeStatus.trim())) {
            drawContainedFrame(canvas, source, source.width, source.height);
            updateStatus('streaming');
          }
        } catch {
          updateStatus('error');
        }
      }
      animationFrame = window.requestAnimationFrame(paint);
    };
    iframe.addEventListener('load', () => {
      animationFrame = window.requestAnimationFrame(paint);
    }, { once: true });
    iframe.addEventListener('error', () => updateStatus('error'), { once: true });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      iframe.src = 'about:blank';
      iframe.remove();
    };
  }, [active, canvas, deviceId]);

  return { canvas, status };
}
