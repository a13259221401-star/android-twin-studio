import { useEffect, useRef, useState } from 'react';
import type { MotionPose } from '../types';

const EMPTY_POSE: MotionPose = {
  seq: 0,
  timestamp: 0,
  tracking: 'STOPPED',
  mode: 'SENSOR_3DOF',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  fps: 0,
};

export function useMotionPose() {
  const [pose, setPose] = useState<MotionPose>(EMPTY_POSE);
  const [connected, setConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const retryTimer = useRef<number | undefined>(undefined);
  const staleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/pose/subscribe`);
      socket.addEventListener('open', () => setConnected(false));
      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as (MotionPose & { type?: string }) | { type: 'tracker-status'; connected: boolean };
          if (payload.type === 'tracker-status' && payload.connected === false) {
            window.clearTimeout(staleTimer.current);
            setConnected(false);
            setPose(EMPTY_POSE);
            setLatency(0);
            return;
          }
          if (!('rotation' in payload) || !payload.rotation || !payload.position) return;
          window.clearTimeout(staleTimer.current);
          staleTimer.current = window.setTimeout(() => {
            setConnected(false);
            setPose(EMPTY_POSE);
            setLatency(0);
          }, 1800);
          setConnected(true);
          setPose(payload);
          setLatency(Math.max(0, Math.round(Date.now() - payload.timestamp)));
        } catch {
          // Ignore malformed packets without turning the local subscriber into a false online state.
        }
      });
      socket.addEventListener('close', () => {
        window.clearTimeout(staleTimer.current);
        setConnected(false);
        setPose(EMPTY_POSE);
        setLatency(0);
        retryTimer.current = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => setConnected(false));
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer.current);
      window.clearTimeout(staleTimer.current);
      socket?.close();
    };
  }, []);

  return { pose, connected, latency };
}

export function quaternionToEuler(rotation: MotionPose['rotation'], mode: MotionPose['mode']) {
  let { x, y, z, w } = rotation;
  if (mode === 'SENSOR_3DOF') {
    const halfSqrt = Math.SQRT1_2;
    const sourceX = x;
    const sourceY = y;
    const sourceZ = z;
    const sourceW = w;
    x = halfSqrt * (sourceX - sourceW);
    y = halfSqrt * (sourceY + sourceZ);
    z = halfSqrt * (sourceZ - sourceY);
    w = halfSqrt * (sourceW + sourceX);
  }
  const sinPitch = 2 * (w * x + y * z);
  const cosPitch = 1 - 2 * (x * x + y * y);
  const pitch = Math.atan2(sinPitch, cosPitch);
  const sinYaw = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const yaw = Math.asin(sinYaw);
  const sinRoll = 2 * (w * z + x * y);
  const cosRoll = 1 - 2 * (y * y + z * z);
  const roll = Math.atan2(sinRoll, cosRoll);
  const toDegrees = 180 / Math.PI;
  return { pitch: pitch * toDegrees, yaw: yaw * toDegrees, roll: roll * toDegrees };
}
