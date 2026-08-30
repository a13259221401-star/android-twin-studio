import { useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, CaretDown, QrCode, Usb, WifiHigh } from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';
import { mirrorApi } from '../lib/api';
import type { AndroidDevice, QuickConnectInfo } from '../types';

interface ConnectionPanelProps {
  selected?: string;
  onSelect: (serial?: string) => void;
  onStreamingChange: (streaming: boolean) => void;
  streaming: boolean;
  connectionMode: 'apk' | 'usb';
  onConnectionModeChange: (mode: 'apk' | 'usb') => void;
}

type Mode = 'connect' | 'pair' | 'usb';

export function ConnectionPanel({
  selected,
  onSelect,
  onStreamingChange,
  streaming,
  connectionMode,
  onConnectionModeChange,
}: ConnectionPanelProps) {
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [mode, setMode] = useState<Mode>('connect');
  const [address, setAddress] = useState('');
  const [pairAddress, setPairAddress] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickConnect, setQuickConnect] = useState<QuickConnectInfo>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState('正在检查本地 ADB…');

  const onlineDevices = useMemo(() => devices.filter((device) => device.state === 'device'), [devices]);
  const usbDevices = useMemo(() => onlineDevices.filter((device) => device.connection === 'usb'), [onlineDevices]);
  const eligibleDevices = connectionMode === 'usb' ? usbDevices : onlineDevices;

  const refresh = async (quiet = false) => {
    try {
      const response = await mirrorApi.devices();
      setDevices(response.devices);
      const online = response.devices.filter((device) => device.state === 'device');
      const eligible = connectionMode === 'usb' ? online.filter((device) => device.connection === 'usb') : online;
      const first = eligible[0];
      const selectedStillOnline = selected ? eligible.some((device) => device.serial === selected) : false;
      if (selected && !selectedStillOnline) {
        onSelect(undefined);
        onStreamingChange(false);
      }
      if (!selected && first) onSelect(first.serial);
      if (!quiet) {
        setNotice(first
          ? connectionMode === 'usb' ? `已发现 ${eligible.length} 台 USB 设备` : `已发现 ${eligible.length} 台在线设备`
          : connectionMode === 'usb' ? '未发现已授权的 USB 手机' : '未发现设备，请使用下方方式连接');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'ADB 检查失败');
    }
  };

  useEffect(() => {
    void refresh();
    void mirrorApi.quickConnect().then(setQuickConnect).catch((error) => {
      setNotice(error instanceof Error ? error.message : '二维码生成失败');
    });
    const timer = window.setInterval(() => void refresh(true), 3000);
    return () => window.clearInterval(timer);
  }, [connectionMode, selected]);

  const autoConnect = () => run(() => mirrorApi.autoConnect());

  const run = async (action: () => Promise<{ message: string; serial?: string }>) => {
    setBusy(true);
    onStreamingChange(false);
    try {
      const result = await action();
      setNotice(result.message);
      await refresh(true);
      if (result.serial) onSelect(result.serial);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="connection-card" aria-label="手机连接设置">
      <div className="transport-switcher" role="group" aria-label="投屏连接方式">
        <button className={connectionMode === 'apk' ? 'active' : ''} onClick={() => onConnectionModeChange('apk')}>
          <WifiHigh size={17} /><span><strong>Tracker Wi‑Fi</strong><small>画面 + 3DoF 姿态</small></span>
        </button>
        <button className={connectionMode === 'usb' ? 'active usb' : ''} onClick={() => onConnectionModeChange('usb')}>
          <Usb size={17} /><span><strong>USB 有线</strong><small>ADB 低延迟画面</small></span>
        </button>
      </div>

      {connectionMode === 'apk' ? <div className="quick-connect">
        <div className="quick-connect-copy">
          <span className="quick-connect-icon"><QrCode size={19} weight="duotone" /></span>
          <div><strong>扫码自动连接</strong><small>用 MotionCast Tracker 扫描，无需输入 IP 或端口</small></div>
        </div>
        <div className="qr-stage">
          {quickConnect ? (
            <QRCodeSVG value={quickConnect.payload} size={154} level="M" marginSize={2} bgColor="#ffffff" fgColor="#15233a" title="MotionCast 自动连接二维码" />
          ) : <div className="qr-loading">正在生成连接码…</div>}
        </div>
        <div className="quick-steps"><span>1 打开 Tracker</span><i /> <span>2 扫描此码</span><i /> <span>3 手机端开始投屏</span></div>
        <button className="auto-discover-button" disabled={busy} onClick={() => void autoConnect()}>
          <WifiHigh size={15} /> ADB 备用：自动发现设备 <ArrowClockwise size={13} />
        </button>
        <small className="quick-connect-help">扫码连接成功后，在手机端点击“开始实时投屏”并确认录屏；无需开启无线调试。</small>
      </div> : (
        <div className="usb-direct-card">
          <div className="usb-cable-mark"><Usb size={25} weight="duotone" /><i /></div>
          <div>
            <strong>{usbDevices.length ? 'USB 通道已就绪' : '连接并授权 USB 手机'}</strong>
            <small>开启开发者选项和 USB 调试，在手机弹窗中选择“允许”</small>
          </div>
          <span className={usbDevices.length ? 'ready' : ''}>{usbDevices.length ? `${usbDevices.length} DEVICE` : 'NO DEVICE'}</span>
        </div>
      )}

      <div className="device-row">
        <div>
          <span className={`status-dot ${onlineDevices.length ? 'online' : ''}`} />
          <strong>{eligibleDevices.length ? connectionMode === 'usb' ? 'USB 设备已连接' : '设备已连接' : '等待连接'}</strong>
        </div>
        <button className="text-button" onClick={() => void refresh()} disabled={busy}>刷新</button>
      </div>

      {eligibleDevices.length ? (
        <label className="field-label">
          投屏设备
          <select value={selected ?? ''} onChange={(event) => onSelect(event.target.value)}>
            {eligibleDevices.map((device) => (
              <option key={device.serial} value={device.serial}>
                {device.model || 'Android'} · {device.serial} · {device.connection === 'wifi' ? 'Wi‑Fi' : 'USB'}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {connectionMode === 'apk' ? <button className="advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
        <span>高级连接方式</span><CaretDown size={13} className={advancedOpen ? 'open' : ''} />
      </button> : null}

      {connectionMode === 'apk' && advancedOpen ? <div className="advanced-content">
        <div className="mode-tabs" role="tablist">
          <button className={mode === 'connect' ? 'active' : ''} onClick={() => setMode('connect')}>Wi‑Fi 连接</button>
          <button className={mode === 'pair' ? 'active' : ''} onClick={() => setMode('pair')}>无线配对</button>
          <button className={mode === 'usb' ? 'active' : ''} onClick={() => setMode('usb')}>USB 转 Wi‑Fi</button>
        </div>

      {mode === 'connect' ? (
        <div className="inline-form">
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="手机 IP:连接端口，例如 192.168.1.8:5555" />
          <button disabled={busy || !address.trim()} onClick={() => void run(() => mirrorApi.connect(address))}>连接</button>
        </div>
      ) : null}

      {mode === 'pair' ? (
        <div className="stack-form">
          <input value={pairAddress} onChange={(event) => setPairAddress(event.target.value)} placeholder="手机 IP:配对端口" />
          <div className="inline-form">
            <input value={pairCode} onChange={(event) => setPairCode(event.target.value)} inputMode="numeric" maxLength={6} placeholder="6 位配对码" />
            <button disabled={busy || !pairAddress.trim() || pairCode.length !== 6} onClick={() => void run(() => mirrorApi.pair(pairAddress, pairCode))}>配对</button>
          </div>
          <small>配对完成后，切回“Wi‑Fi 连接”，填写无线调试页显示的连接地址。</small>
        </div>
      ) : null}

      {mode === 'usb' ? (
        <div className="stack-form">
          <small>适用于旧版 Android：先用 USB 授权，再自动切换到 5555 端口。</small>
          <button
            className="wide-button"
            disabled={busy || !usbDevices.length}
            onClick={() => usbDevices[0] && void run(() => mirrorApi.enableWifi(usbDevices[0].serial))}
          >
            {usbDevices.length ? `将 ${usbDevices[0].model || 'USB 手机'} 切换到 Wi‑Fi` : '请先连接 USB 手机'}
          </button>
        </div>
      ) : null}
      </div> : null}

      <p className="connection-notice">{notice}</p>

      {connectionMode === 'usb' ? <button
        className="primary-button"
        disabled={!selected || busy}
        onClick={() => onStreamingChange(!streaming)}
      >
        <span>{streaming ? '停止 USB 投屏' : '开始 USB 投屏'}</span>
        <span aria-hidden="true">{streaming ? '■' : '▶'}</span>
      </button> : null}
    </section>
  );
}
