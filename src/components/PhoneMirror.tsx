import { useEffect, useMemo, useRef, useState } from 'react';

const MIRROR_EMBED_STYLE = `
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    background: #02050c !important;
  }

  .control-wrapper,
  .control-buttons-list {
    display: none !important;
  }

  .device-view {
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    display: block !important;
    overflow: hidden !important;
  }

  .video {
    position: relative !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    display: grid !important;
    overflow: hidden !important;
  }

  .video-layer,
  .touch-layer {
    grid-area: 1 / 1 !important;
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    max-height: none !important;
    object-fit: contain !important;
  }
`;

export interface ScreenPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  perspective?: number;
  borderRadius?: number;
}

interface PhoneMirrorProps {
  deviceId?: string;
  overlay: string;
  runtimeUrl: string;
  active: boolean;
  screen: ScreenPlacement;
  designWidth?: number;
  designHeight?: number;
}

export function PhoneMirror({
  deviceId,
  overlay,
  runtimeUrl,
  active,
  screen,
  designWidth = 1536,
  designHeight = 1024,
}: PhoneMirrorProps) {
  const [frameLoaded, setFrameLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const streamUrl = useMemo(() => {
    if (!deviceId || !active) return undefined;
    // Load the embed shell through Vite's same-origin proxy. ws-scrcpy-web
    // intentionally sends X-Frame-Options: SAMEORIGIN. Its video WebSocket
    // also uses the current page origin and is forwarded by Vite to port 8000.
    const url = new URL('/mirror-runtime/embed.html', window.location.origin);
    url.searchParams.set('device', deviceId);
    url.searchParams.set('codec', 'h264');
    url.searchParams.set('maxFps', '60');
    url.searchParams.set('maxSize', '2560');
    url.searchParams.set('bitrate', '20000000');
    // Keep the audio socket enabled. The current ws-scrcpy-web reverse-tunnel
    // path waits for video/audio/control sockets even when audio=false.
    url.searchParams.set('audio', 'true');
    url.searchParams.set('keyboard', 'false');
    url.searchParams.set('deviceKind', 'phone');
    return url.toString();
  }, [active, deviceId, runtimeUrl]);

  useEffect(() => {
    setFrameLoaded(false);
  }, [streamUrl]);

  const prepareEmbed = (iframe: HTMLIFrameElement) => {
    const document = iframe.contentDocument;
    if (!document?.head || document.head.querySelector('[data-phone-mirror-style]')) return;

    const style = document.createElement('style');
    style.dataset.phoneMirrorStyle = 'true';
    style.textContent = MIRROR_EMBED_STYLE;
    document.head.appendChild(style);
  };

  const viewportStyle = {
    left: `${(screen.left / designWidth) * 100}%`,
    top: `${(screen.top / designHeight) * 100}%`,
    width: `${(screen.width / designWidth) * 100}%`,
    height: `${(screen.height / designHeight) * 100}%`,
    borderRadius: `${screen.borderRadius ?? 40}px`,
    transform: `perspective(${screen.perspective ?? 1200}px) rotate(${screen.rotate ?? 0}deg) rotateX(${screen.rotateX ?? 0}deg) rotateY(${screen.rotateY ?? 0}deg)`,
  };

  return (
    <div className="phone-mirror" style={{ aspectRatio: `${designWidth} / ${designHeight}` }} aria-label="Android 手机实时画面">
      <div className="mirror-glow mirror-glow-a" />
      <div className="mirror-glow mirror-glow-b" />

      <div className="screen-viewport" style={viewportStyle}>
        {streamUrl ? (
          <iframe
            ref={iframeRef}
            key={streamUrl}
            className="mirror-frame"
            src={streamUrl}
            title="Android 实时投屏"
            allow="autoplay"
            onLoad={(event) => {
              prepareEmbed(event.currentTarget);
              setFrameLoaded(true);
            }}
          />
        ) : (
          <div className="screen-placeholder">
            <span className="placeholder-orbit" />
            <span className="placeholder-logo">P</span>
            <strong>{deviceId ? '点击开始投屏' : '等待连接手机'}</strong>
            <small>Wi‑Fi ADB · 本地低延迟</small>
          </div>
        )}
        {streamUrl && !frameLoaded ? <div className="stream-loading">正在建立视频流…</div> : null}
      </div>

      <img className="phone-overlay" src={overlay} alt="真人手持手机模型" draggable={false} />
      <div className="phone-shine" aria-hidden="true" />
    </div>
  );
}
