import { useEffect, useMemo, useState } from 'react';
import {
  ArrowCounterClockwise,
  Broadcast,
  CheckCircle,
  DeviceMobile,
  GearSix,
  QrCode,
  SlidersHorizontal,
  WifiHigh,
} from '@phosphor-icons/react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { TwinPhoneScene } from './components/TwinPhoneScene';
import { quaternionToEuler, useMotionPose } from './hooks/useMotionPose';
import type { ApkScreenStatus } from './hooks/useApkScreenStream';
import { mirrorApi } from './lib/api';

type FrameColor = 'emerald' | 'iceblue' | 'graphite' | 'gold' | 'silver';
type PoseViewMode = 'live' | 'showcase';

function App() {
  const [deviceId, setDeviceId] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeUrl, setRuntimeUrl] = useState('http://127.0.0.1:8000');
  const [poseEnabled] = useState(true);
  const [poseViewMode, setPoseViewMode] = useState<PoseViewMode>('live');
  const [smoothing, setSmoothing] = useState(72);
  const [positionFollowEnabled, setPositionFollowEnabled] = useState(true);
  const [movementGain, setMovementGain] = useState(2.8);
  const [frameColor, setFrameColor] = useState<FrameColor>('emerald');
  const [showConnections, setShowConnections] = useState(false);
  const [apkScreenStatus, setApkScreenStatus] = useState<ApkScreenStatus>('waiting');
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
      return;
    }
    if (!deviceId) {
      setShowConnections(true);
      return;
    }
    try { await mirrorApi.preparePose(deviceId); } catch { /* APK direct stream does not require ADB reverse. */ }
    const status = runtimeReady ? { ready: true, url: runtimeUrl } : await mirrorApi.runtime();
    setRuntimeReady(status.ready);
    setRuntimeUrl(status.url);
    if (status.ready) setStreaming(true);
    else setNotice('本地 ADB 投屏运行时未启动；仍可使用 APK 扫码直连');
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

  const apkScreenLive = apkScreenStatus === 'streaming';
  const connected = apkScreenLive || poseConnected;
  const connectionLabel = apkScreenLive
    ? '画面在线'
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
        <div className={`live-chip ${connected ? 'online' : ''}`}><i />{apkScreenLive ? '实时画面' : poseConnected ? '姿态同步' : '等待手机'}</div>
        <div className="height-ruler" aria-hidden="true"><span>2m</span><span>1m</span><span>0m</span><span>−1m</span></div>
        <TwinPhoneScene
          pose={pose}
          poseEnabled={poseEnabled && poseConnected}
          smoothing={smoothing}
          positionFollowEnabled={positionFollowEnabled}
          movementGain={movementGain}
          deviceId={deviceId}
          streaming={streaming}
          runtimeUrl={runtimeUrl}
          frameColor={frameColor}
          viewMode={poseViewMode}
          onApkScreenStatusChange={setApkScreenStatus}
        />
        <div className="stage-statusbar">
          <span>帧率 <b>{apkScreenLive ? '60' : Math.round(pose.fps || 0)} FPS</b></span>
          <span>延迟 <b>{poseConnected ? latency : '--'} ms</b><i className={poseConnected ? 'online' : ''} /></span>
          <span>分辨率 <b>{apkScreenLive || streaming ? '1080 × 2400' : '--'}</b></span>
        </div>
        <div className="stage-caption">6DoF 实时数字孪生</div>
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
          <span>姿态质量</span><strong className={pose.tracking === 'TRACKING' ? 'good' : ''}><i />{poseQuality} · {pose.mode === 'ARCORE_6DOF' ? '6DoF' : '3DoF'}</strong>
        </section>

        <section className="inspector-section">
          <h2>位置 <small>(m)</small></h2>
          <dl className="value-list">
            <div><dt>x</dt><dd>{pose.position.x.toFixed(3)}</dd></div>
            <div><dt>y</dt><dd>{pose.position.y.toFixed(3)}</dd></div>
            <div><dt>z</dt><dd>{pose.position.z.toFixed(3)}</dd></div>
          </dl>
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
          <div className="follow-control">
            <span><b>真实位移</b><small>ARCore 6DoF</small></span>
            <button
              type="button"
              className={positionFollowEnabled ? 'active' : ''}
              aria-pressed={positionFollowEnabled}
              onClick={() => setPositionFollowEnabled((value) => !value)}
            ><i /></button>
          </div>
          <label className={!positionFollowEnabled ? 'disabled-control' : ''}>
            <span>位移灵敏度 <b>{movementGain.toFixed(1)}×</b></span>
            <input type="range" min="1" max="4" step="0.1" disabled={!positionFollowEnabled} value={movementGain} onChange={(event) => setMovementGain(Number(event.target.value))} />
          </label>
          <p className="follow-help">左右、升降和远近跟随仅在 Tracker 前台的 ARCore 6DoF 模式生效；切到其他 App 后会保留旋转，但暂停真实位移。</p>
          <div className="frame-row"><span>机身</span><div>{(['emerald', 'silver', 'graphite', 'iceblue', 'gold'] as const).map((color) => <button key={color} className={`${color} ${frameColor === color ? 'selected' : ''}`} onClick={() => setFrameColor(color)} aria-label={`选择 ${color} 机身`} />)}</div></div>
        </section>

        <button className="mirror-button" onClick={() => apkScreenLive ? setShowConnections(true) : void changeStreaming(!streaming)}>
          <DeviceMobile size={17} weight="duotone" />
          {apkScreenLive ? '管理手机连接' : streaming ? '停止 ADB 镜像' : '连接实时画面'}
        </button>
        <footer className="inspector-footer"><span><WifiHigh size={14} />{apkScreenLive ? 'APK Wi‑Fi 直连' : streaming ? 'ADB Wi‑Fi' : '本地网络'}</span><span><CheckCircle size={14} weight="fill" />数据仅在局域网传输</span></footer>
      </aside>

      {notice ? <div className="lab-toast">{notice}</div> : null}

      {showConnections ? (
        <div className="connection-drawer" role="dialog" aria-label="连接中心">
          <button className="drawer-backdrop" aria-label="关闭连接中心" onClick={() => setShowConnections(false)} />
          <div className="drawer-panel">
            <div className="drawer-title"><div><span>DEVICE LINK</span><strong>连接 Android 手机</strong></div><button onClick={() => setShowConnections(false)}>×</button></div>
            <ConnectionPanel selected={deviceId} onSelect={setDeviceId} streaming={streaming} onStreamingChange={(next) => void changeStreaming(next)} />
            <div className="drawer-note">推荐使用 MotionCast Tracker 扫码并允许录屏；画面与姿态会通过同一条 Wi‑Fi 连接自动进入网页。</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
