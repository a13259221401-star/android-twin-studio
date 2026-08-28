import { useEffect, useMemo, useState } from 'react';
import { useApkScreenStream, type ApkScreenStatus } from '../hooks/useApkScreenStream';

const EMBED_STYLE = `
  html, body { width: 100% !important; height: 100% !important; margin: 0 !important; overflow: hidden !important; background: #080808 !important; }
  .control-wrapper, .control-buttons-list { display: none !important; }
  .device-view, .video { width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; display: grid !important; overflow: hidden !important; }
  .video-layer, .touch-layer { grid-area: 1 / 1 !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; object-fit: cover !important; }
`;

interface MirrorScreenProps {
  deviceId?: string;
  active: boolean;
  runtimeUrl: string;
  onApkStatusChange?: (status: ApkScreenStatus) => void;
}

export function MirrorScreen({ deviceId, active, runtimeUrl, onApkStatusChange }: MirrorScreenProps) {
  const [loaded, setLoaded] = useState(false);
  const { canvasRef, status: apkStatus } = useApkScreenStream(onApkStatusChange);
  const streamUrl = useMemo(() => {
    if (!deviceId || !active) return undefined;
    const url = new URL('/mirror-runtime/embed.html', window.location.origin);
    url.searchParams.set('device', deviceId);
    url.searchParams.set('codec', 'h264');
    url.searchParams.set('maxFps', '60');
    url.searchParams.set('maxSize', '2560');
    url.searchParams.set('bitrate', '20000000');
    url.searchParams.set('audio', 'true');
    url.searchParams.set('keyboard', 'false');
    url.searchParams.set('deviceKind', 'phone');
    return url.toString();
  }, [active, deviceId, runtimeUrl]);

  useEffect(() => setLoaded(false), [streamUrl]);

  return (
    <div className="twin-screen-content">
      <canvas ref={canvasRef} className={`apk-screen ${apkStatus === 'streaming' ? 'is-live' : ''}`} aria-label="APK 实时屏幕" />
      {apkStatus !== 'streaming' && streamUrl ? (
        <iframe
          src={streamUrl}
          title="Android 实时屏幕"
          allow="autoplay"
          onLoad={(event) => {
            const doc = event.currentTarget.contentDocument;
            if (doc?.head && !doc.head.querySelector('[data-twin-embed-style]')) {
              const style = doc.createElement('style');
              style.dataset.twinEmbedStyle = 'true';
              style.textContent = EMBED_STYLE;
              doc.head.appendChild(style);
            }
            setLoaded(true);
          }}
        />
      ) : apkStatus !== 'streaming' ? (
        <div className="twin-screen-idle">
          <span>APK DIRECT STREAM</span>
          <strong>{apkStatus === 'unsupported' ? 'UNSUPPORTED' : apkStatus === 'error' ? 'RETRY' : 'SCAN'}</strong>
          <small>{apkStatus === 'unsupported' ? '当前浏览器不支持 WebCodecs' : '使用 Tracker 扫码并允许录制屏幕'}</small>
        </div>
      ) : null}
      {apkStatus === 'connecting' || (apkStatus !== 'streaming' && streamUrl && !loaded) ? <div className="twin-screen-loading">正在同步屏幕…</div> : null}
    </div>
  );
}
