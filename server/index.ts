import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import type { Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { extractWlanAddress, listDevices, runAdb, validateEndpoint } from './adb.js';
import { startMirrorRuntime } from './runtime.js';

const app = express();
const port = Number(process.env.PHONE_MIRROR_API_PORT || 8787);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const httpServer = createServer(app);
const poseServer = new WebSocketServer({ noServer: true });
const poseSubscribers = new Set<WebSocket>();
const screenSubscribers = new Set<WebSocket>();
const posePublishers = new Set<WebSocket>();
const publisherSources = new Map<WebSocket, string>();
const publisherLastSeen = new Map<WebSocket, number>();
const quickConnectToken = randomBytes(18).toString('base64url');
let latestPose: unknown = null;
let latestVideoConfig: string | null = null;
let lastPoseAt = 0;
let lastVideoFrameAt = 0;
let videoLive = false;

const TRACKER_STALE_MS = 1800;
const VIDEO_STALE_MS = 2200;
const PUBLISHER_STALE_MS = 6500;

app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/pose', (_request, response) => {
  const connected = latestPose !== null && Date.now() - lastPoseAt <= TRACKER_STALE_MS;
  response.json({ connected, pose: connected ? latestPose : null });
});

app.get('/api/quick-connect', (_request, response) => {
  const host = findLanAddress();
  if (!host) {
    response.status(503).json({ message: '未找到电脑局域网地址，请确认电脑已连接 Wi-Fi' });
    return;
  }
  const websocketUrl = `ws://${host}:${port}/pose/publish`;
  const payload = `motioncast://connect?ws=${encodeURIComponent(websocketUrl)}&token=${encodeURIComponent(quickConnectToken)}`;
  response.json({ available: true, host, port, websocketUrl, payload });
});

app.post('/api/pose/prepare', async (request, response) => {
  try {
    const serial = String(request.body?.serial || '').trim();
    if (!serial) throw new Error('请选择 Android 设备');
    await runAdb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], 10000);
    response.json({ ok: true, message: `姿态通道已连接：Android localhost:${port} → 电脑` });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '姿态通道连接失败' });
  }
});

app.post('/api/pose/calibrate', (_request, response) => {
  const publishers = [...posePublishers].filter((publisher) => publisher.readyState === WebSocket.OPEN);
  if (!publishers.length) {
    response.status(409).json({ message: 'Tracking APK 尚未连接' });
    return;
  }
  for (const publisher of publishers) publisher.send(JSON.stringify({ type: 'command', command: 'calibrate' }));
  response.json({ ok: true, message: '已开始静置采样，请保持手机不动约 1 秒' });
});

app.get('/api/runtime', async (_request, response) => {
  const configuredPort = Number(process.env.PHONE_MIRROR_RUNTIME_PORT || 0);
  const ports = configuredPort ? [configuredPort] : Array.from({ length: 11 }, (_, index) => 8000 + index);
  for (const runtimePort of ports) {
    const url = `http://127.0.0.1:${runtimePort}`;
    try {
      const runtimeResponse = await fetch(`${url}/embed.html`, { signal: AbortSignal.timeout(350) });
      if (runtimeResponse.ok) {
        response.json({ ready: true, url });
        return;
      }
    } catch {
      // Continue through the small, local-only port range.
    }
  }
  response.json({ ready: false, url: `http://127.0.0.1:${configuredPort || 8000}` });
});

app.post('/api/runtime/start', async (_request, response) => {
  try {
    const output = await startMirrorRuntime(root);
    response.json({ ok: true, message: output || 'USB 投屏运行时已启动' });
  } catch (error) {
    response.status(503).json({
      message: error instanceof Error
        ? `${error.message}。请先执行 npm run runtime:install`
        : 'USB 投屏运行时启动失败',
    });
  }
});

app.get('/api/devices', async (_request, response) => {
  try {
    response.json(await listDevices());
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : '无法读取设备' });
  }
});

app.post('/api/adb/connect', async (request, response) => {
  try {
    const address = validateEndpoint(request.body?.address, 5555);
    const output = await runAdb(['connect', address], 20000);
    if (/failed|cannot|unable/i.test(output)) throw new Error(output);
    response.json({ ok: true, message: output || `已连接 ${address}`, serial: address, address });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : 'Wi‑Fi 连接失败' });
  }
});

app.post('/api/adb/auto-connect', async (_request, response) => {
  try {
    const current = await listDevices();
    const online = current.devices.find((device) => device.state === 'device');
    if (online) {
      response.json({ ok: true, message: `已自动选择 ${online.model || 'Android 手机'}`, serial: online.serial });
      return;
    }

    const services = await runAdb(['mdns', 'services'], 10000);
    const endpoint = services
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes('_adb-tls-connect._tcp'))
      .map((line) => line.split(/\s+/).at(-1))
      .find((value): value is string => Boolean(value));
    if (!endpoint) throw new Error('未发现已配对手机；首次使用请先完成一次系统无线配对或 USB 授权');

    const address = validateEndpoint(endpoint);
    const output = await runAdb(['connect', address], 20000);
    if (/failed|cannot|unable/i.test(output)) throw new Error(output);
    response.json({ ok: true, message: `已自动发现并连接 ${address}`, serial: address, address });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '自动发现失败' });
  }
});

app.post('/api/adb/pair', async (request, response) => {
  try {
    const address = validateEndpoint(request.body?.address);
    const code = String(request.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw new Error('请输入手机显示的 6 位无线配对码');
    const output = await runAdb(['pair', address, code], 30000);
    if (!/successfully paired/i.test(output)) throw new Error(output || '配对失败');
    response.json({ ok: true, message: output, address });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '无线配对失败' });
  }
});

app.post('/api/wifi/enable', async (request, response) => {
  try {
    const serial = String(request.body?.serial || '').trim();
    const portValue = Number(request.body?.port || 5555);
    if (!serial || !Number.isInteger(portValue) || portValue < 1024 || portValue > 65535) {
      throw new Error('设备或端口无效');
    }
    const { devices } = await listDevices();
    const usbDevice = devices.find((device) => device.serial === serial && device.connection === 'usb' && device.state === 'device');
    if (!usbDevice) throw new Error('USB 设备不存在或尚未授权');

    const networkInfo = await runAdb(['-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']);
    const ipAddress = extractWlanAddress(networkInfo);
    if (!ipAddress) throw new Error('无法读取手机 Wi‑Fi 地址，请确认手机已连接局域网');

    await runAdb(['-s', serial, 'tcpip', String(portValue)], 20000);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const address = `${ipAddress}:${portValue}`;
    const output = await runAdb(['connect', address], 20000);
    if (/failed|cannot|unable/i.test(output)) throw new Error(output);
    response.json({ ok: true, message: `已切换为 Wi‑Fi：${address}`, serial: address, address });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : '切换 Wi‑Fi 失败' });
  }
});

const dist = path.join(root, 'dist');
app.use(express.static(dist));
app.get('/{*path}', (_request, response) => response.sendFile(path.join(dist, 'index.html')));

function handlePoseConnection(webSocket: WebSocket, role: string, source = 'unknown') {
  if (role === '/pose/subscribe') {
    poseSubscribers.add(webSocket);
    if (latestPose !== null && Date.now() - lastPoseAt <= TRACKER_STALE_MS) webSocket.send(JSON.stringify(latestPose));
    else webSocket.send(JSON.stringify({ type: 'tracker-status', connected: false }));
    webSocket.on('close', () => poseSubscribers.delete(webSocket));
    return;
  }

  if (role === '/screen/subscribe') {
    screenSubscribers.add(webSocket);
    if (latestVideoConfig) webSocket.send(latestVideoConfig);
    webSocket.send(JSON.stringify({ type: 'video-status', connected: videoLive && Date.now() - lastVideoFrameAt <= VIDEO_STALE_MS }));
    const requestKeyFrame = JSON.stringify({ type: 'command', command: 'request-keyframe' });
    for (const [publisher, publisherSource] of publisherSources) {
      if (publisherSource === 'projection' && publisher.readyState === WebSocket.OPEN) publisher.send(requestKeyFrame);
    }
    webSocket.on('close', () => screenSubscribers.delete(webSocket));
    return;
  }

  posePublishers.add(webSocket);
  publisherSources.set(webSocket, source);
  publisherLastSeen.set(webSocket, Date.now());
  webSocket.on('message', (payload, isBinary) => {
    publisherLastSeen.set(webSocket, Date.now());
    if (isBinary) {
      lastVideoFrameAt = Date.now();
      if (!videoLive) {
        videoLive = true;
        broadcastScreen(JSON.stringify({ type: 'video-status', connected: true }));
      }
      for (const subscriber of screenSubscribers) {
        if (subscriber.readyState === WebSocket.OPEN && subscriber.bufferedAmount < 2 * 1024 * 1024) {
          subscriber.send(payload, { binary: true });
        }
      }
      return;
    }
    try {
      const message = JSON.parse(payload.toString()) as { type?: string; mode?: string; tracking?: string };
      const serialized = JSON.stringify(message);
      if (message.type === 'video-config' || message.type === 'video-status') {
        if (message.type === 'video-config') latestVideoConfig = serialized;
        broadcastScreen(serialized);
        return;
      }
      const projectionAvailable = [...publisherSources.entries()].some(([publisher, publisherSource]) =>
        publisher !== webSocket && publisherSource === 'projection' && publisher.readyState === WebSocket.OPEN
      );
      if (message.type === 'pose' && source === 'activity' && projectionAvailable) return;
      latestPose = message;
      lastPoseAt = Date.now();
      broadcastPose(serialized);
    } catch {
      webSocket.send(JSON.stringify({ type: 'error', message: 'invalid pose payload' }));
    }
  });
  webSocket.on('close', () => {
    const closedSource = publisherSources.get(webSocket);
    posePublishers.delete(webSocket);
    publisherSources.delete(webSocket);
    publisherLastSeen.delete(webSocket);
    if (closedSource === 'projection') {
      const projectionStillOnline = [...publisherSources.entries()].some(([publisher, publisherSource]) =>
        publisherSource === 'projection' && publisher.readyState === WebSocket.OPEN
      );
      if (!projectionStillOnline) {
        videoLive = false;
        latestVideoConfig = null;
        broadcastScreen(JSON.stringify({ type: 'video-status', connected: false }));
      }
    }
    if (posePublishers.size === 0) {
      latestPose = null;
      lastPoseAt = 0;
      broadcastPose(JSON.stringify({ type: 'tracker-status', connected: false }));
    }
  });
}

function broadcastPose(payload: string) {
  for (const subscriber of poseSubscribers) {
    if (subscriber.readyState === WebSocket.OPEN) subscriber.send(payload);
  }
}

function broadcastScreen(payload: string) {
  for (const subscriber of screenSubscribers) {
    if (subscriber.readyState === WebSocket.OPEN) subscriber.send(payload);
  }
}

const livenessWatchdog = setInterval(() => {
  const now = Date.now();
  if (latestPose !== null && now - lastPoseAt > TRACKER_STALE_MS) {
    latestPose = null;
    lastPoseAt = 0;
    broadcastPose(JSON.stringify({ type: 'tracker-status', connected: false }));
  }
  if (videoLive && now - lastVideoFrameAt > VIDEO_STALE_MS) {
    videoLive = false;
    broadcastScreen(JSON.stringify({ type: 'video-status', connected: false }));
  }
  for (const [publisher, lastSeen] of publisherLastSeen) {
    if (now - lastSeen > PUBLISHER_STALE_MS) publisher.terminate();
  }
}, 600);
livenessWatchdog.unref();

httpServer.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  const pathname = requestUrl.pathname;
  if (pathname !== '/pose/publish' && pathname !== '/pose/subscribe' && pathname !== '/screen/subscribe') {
    socket.destroy();
    return;
  }

  const remoteAddress = (socket as Socket).remoteAddress || '';
  const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress.endsWith('::ffff:127.0.0.1');
  if (pathname === '/pose/publish' && !isLoopback && requestUrl.searchParams.get('token') !== quickConnectToken) {
    socket.destroy();
    return;
  }

  poseServer.handleUpgrade(request, socket, head, (webSocket) => {
    handlePoseConnection(webSocket, pathname, requestUrl.searchParams.get('source') || 'unknown');
  });
});

function findLanAddress(): string | undefined {
  const candidates = Object.values(os.networkInterfaces())
    .flatMap((interfaces) => interfaces || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  return candidates.find((address) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) || candidates[0];
}

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`[phone-mirror-api] http://127.0.0.1:${port} · QR quick connect enabled`);
});
