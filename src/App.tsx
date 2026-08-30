import { useEffect, useMemo, useState } from 'react';
import {
  ArrowCounterClockwise,
  Broadcast,
  CheckCircle,
  DeviceMobile,
  GearSix,
  QrCode,
  SlidersHorizontal,
  Usb,
  WifiHigh,
} from '@phosphor-icons/react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { TwinPhoneScene } from './components/TwinPhoneScene';
import { quaternionToEuler, useMotionPose } from './hooks/useMotionPose';
import type { ApkScreenStatus } from './hooks/useApkScreenStream';
import { mirrorApi } from './lib/api';

type FrameColor = 'emerald' | 'iceblue' | 'graphite' | 'gold' | 'silver';
type PoseViewMode = 'live' | 'showcase';
type ConnectionMode = 'apk' | 'usb';

function App() {
  const [deviceId, setDeviceId] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('apk');
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeUrl, setRuntimeUrl] = useState('http://127.0.0.1:8000');
  const [poseEnabled] = useState(true);
  const [poseViewMode, setPoseViewMode] = useState<PoseViewMode>('live');
  const [smoothing, setSmoothing] = useState(72);
  const [frameColor, setFrameColor] = useState<FrameColor>('emerald');
  const [showConnections, setShowConnections] = useState(false);
  const [screenStatus, setScreenStatus] = useState<ApkScreenStatus>('waiting');
  const [notice, setNotice] = useState('');
  const [calibrating, setCalibrating] = useState(false);
  const { pose, connected: poseConnected, latency } = useMotionPose();
  const euler = useMemo(
    () => poseConnected ? quaternionToEuler(pose.rotation, pose.mode) : { pitch: 0, yaw: 0, roll: 0 },
    [pose.mode, pose.rotation, poseConnected],
  );

  useEffect(() => {
    void mirrorApi.runtime().then((status) => {
      setRuntimeReady(status.ready);
      setRuntimeUrl(status.url);
    }).catch(() => setRuntimeReady(false));
  }, []);

  const changeStreaming = async (next: boolean) => {
    if (!next) {
      setStreaming(false);
      setScreenStatus('waiting');
      return;
    }
    if (connectionMode !== 'usb') {
      setShowConnections(true);
      return;
    }
    if (!deviceId) {
      setShowConnections(true);
      return;
    }
    setScreenStatus('connecting');
    let status = runtimeReady ? { ready: true, url: runtimeUrl } : await mirrorApi.runtime();
    if (!status.ready) {
      try {
        await mirrorApi.startRuntime();
        status = await mirrorApi.runtime();
      } catch (error) {
        setScreenStatus('error');
        setNotice(error instanceof Error ? error.message : 'USB 投屏运行时启动失败');
        return;
      }
    }
    setRuntimeReady(status.ready);
    setRuntimeUrl(status.url);
    if (status.ready) setStreaming(true);
    else setNotice('USB 投屏运行时未就绪，请执行 npm run runtime:install');
  };

  const changeConnectionMode = (next: ConnectionMode) => {
    setStreaming(false);
    setScreenStatus('waiting');
    setConnectionMode(next);
  };

  const calibrate = async () => {
    if (calibrating || !poseConnected) return;
    setCalibrating(true);
    setNotice('保持手机静止，正在校准水平朝向；俯仰与翻转会保留…');
    try {
      await mirrorApi.calibratePose();
      window.setTimeout(() => {
        setCalibrating(false);
        setPoseViewMode('live');
        setNotice('水平朝向已校准；手机平放时网页也会平放');
        window.setTimeout(() => setNotice(''), 2200);
      }, 1300);
    } catch (error) {
      setCalibrating(false);
      setNotice(error instanceof Error ? error.message : '校准失败');
      window.setTimeout(() => setNotice(''), 2400);
    }
  };

  const screenLive = screenStatus === 'streaming';
  const usbScreenLive = connectionMode === 'usb' && screenLive;
  const connected = screenLive || poseConnected;
  const connectionLabel = screenLive
    ? usbScreenLive ? 'USB 画面在线' : '画面在线'
    : poseConnected
      ? '姿态在线'
      : streaming
        ? '正在连接'
        : deviceId
          ? '设备已选择'
          : '等待连接';
  const poseQuality = !poseConnected ? '等待连接' : pose.tracking === 'CALIBRATING' ? '校准中' : pose.tracking === 'TRACKING' ? '稳定' : '受限';

  return (
    <main className="twin-lab">
      <header className="lab-header">
        <a className="lab-brand" href="#studio" aria-label="Android Twin Studio 首页">
          <span className="brand-mark"><Broadcast size={16} weight="fill" /></span>
          <strong>Android Twin Studio</strong>
          <small>本地演示</small>
        </a>
        <div className="header-actions">
          <span className={`connection-chip ${connected ? 'online' : ''}`}><i />{connectionLabel}{deviceId ? <em>{deviceId}</em> : null}</span>
          <button type="button" className="header-button" onClick={() => setShowConnections(true)}><QrCode size={17} />扫码配对</button>
          <button type="button" className="header-icon" aria-label="设置"><GearSix size={19} /></button>
        </div>
      </header>

      <section id="studio" className="lab-stage" aria-label="Android 实时数字孪生舞台">
        <div className={`live-chip ${connected ? 'online' : ''}`}><i />{usbScreenLive ? 'USB 有线画面' : screenLive ? '实时画面' : poseConnected ? '姿态同步' : '等待手机'}</div>
        <div className="height-ruler" aria-hidden="true"><span>2m</span><span>1m</span><span>0m</span><span>−1m</span></div>
        <TwinPhoneScene
          pose={pose}
          poseEnabled={poseEnabled && poseConnected}
          smoothing={smoothing}
          deviceId={deviceId}
          streaming={streaming}
          runtimeUrl={runtimeUrl}
          connectionMode={connectionMode}
          frameColor={frameColor}
          viewMode={poseViewMode}
          onApkScreenStatusChange={setScreenStatus}
        />
        <div className="stage-statusbar">
          <span>帧率 <b>{screenLive ? '30' : Math.round(pose.fps || 0)} FPS</b></span>
          <span>延迟 <b>{poseConnected ? latency : '--'} ms</b><i className={poseConnected ? 'online' : ''} /></span>
          <span>分辨率 <b>{usbScreenLive ? '最高 1920p' : screenLive ? '1080 × 2400' : '--'}</b></span>
        </div>
        <div className="stage-caption">{connectionMode === 'usb' ? 'USB · ADB 有线低延迟' : '3DoF 实时姿态同步'}</div>
      </section>

      <aside className="pose-inspector" aria-label="姿态控制">
        <div className="inspector-heading">
          <div><span>DEVICE POSE</span><h1>姿态控制</h1></div>
          <SlidersHorizontal size={18} />
        </div>

        <div className="mode-switcher" role="group" aria-label="姿态模式">
          <button className={poseViewMode === 'live' ? 'active' : ''} onClick={() => setPoseViewMode('live')}>真实姿态</button>
          <button className={poseViewMode === 'showcase' ? 'active' : ''} onClick={() => setPoseViewMode('showcase')}>展示姿态</button>
        </div>

        <button className="zero-button" disabled={calibrating || !poseConnected} onClick={() => void calibrate()}>
          <ArrowCounterClockwise className={calibrating ? 'spinning' : ''} size={16} />
          {calibrating ? '正在采样航向…' : '校准水平朝向'}
        </button>
        <p className="zero-help">校准只归零水平朝向，不改变重力决定的俯仰与翻转；手机平放时，网页也会保持平放。</p>

        <section className="inspector-section quality-row">
          <span>姿态质量</span><strong className={pose.tracking === 'TRACKING' ? 'good' : ''}><i />{poseQuality} · 3DoF</strong>
        </section>

        <section className="inspector-section">
          <h2>旋转 <small>(°)</small></h2>
          <dl className="value-list">
            <div><dt>pitch (X)</dt><dd>{euler.pitch.toFixed(2)}°</dd></div>
            <div><dt>yaw (Y)</dt><dd>{euler.yaw.toFixed(2)}°</dd></div>
            <div><dt>roll (Z)</dt><dd>{euler.roll.toFixed(2)}°</dd></div>
          </dl>
        </section>

        <section className="inspector-section compact-controls">
          <label><span>稳定度 <b>{smoothing}%</b></span><input type="range" min="20" max="92" value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value))} /></label>
          <div className="frame-row"><span>机身</span><div>{(['emerald', 'silver', 'graphite', 'iceblue', 'gold'] as const).map((color) => <button key={color} className={`${color} ${frameColor === color ? 'selected' : ''}`} onClick={() => setFrameColor(color)} aria-label={`选择 ${color} 机身`} />)}</div></div>
        </section>

        <button className="mirror-button" onClick={() => connectionMode === 'usb' ? void changeStreaming(!streaming) : setShowConnections(true)}>
          <DeviceMobile size={17} weight="duotone" />
          {connectionMode === 'usb' ? streaming ? '停止 USB 投屏' : '开始 USB 投屏' : '管理手机连接'}
        </button>
        <footer className="inspector-footer"><span>{connectionMode === 'usb' ? <Usb size={14} /> : <WifiHigh size={14} />}{connectionMode === 'usb' ? 'USB · ADB 有线' : screenLive ? 'APK Wi‑Fi 直连' : '本地网络'}</span><span><CheckCircle size={14} weight="fill" />{connectionMode === 'usb' ? '画面仅在本机传输' : '数据仅在局域网传输'}</span></footer>
      </aside>

      {notice ? <div className="lab-toast">{notice}</div> : null}

      {showConnections ? (
        <div className="connection-drawer" role="dialog" aria-label="连接中心">
          <button className="drawer-backdrop" aria-label="关闭连接中心" onClick={() => setShowConnections(false)} />
          <div className="drawer-panel">
            <div className="drawer-title"><div><span>DEVICE LINK</span><strong>连接 Android 手机</strong></div><button onClick={() => setShowConnections(false)}>×</button></div>
            <ConnectionPanel
              selected={deviceId}
              onSelect={setDeviceId}
              streaming={streaming}
              onStreamingChange={(next) => void changeStreaming(next)}
              connectionMode={connectionMode}
              onConnectionModeChange={changeConnectionMode}
            />
            <div className="drawer-note">{connectionMode === 'usb' ? 'USB 模式需要在手机开发者选项中开启 USB 调试，并在手机上允许当前电脑调试。' : 'Tracker 模式通过同一 Wi‑Fi 传输画面与姿态；每次重新打开 APP 都需要重新扫码。'}</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
