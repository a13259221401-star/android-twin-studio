import type { ActionResponse, DeviceResponse, QuickConnectInfo, RuntimeStatus } from '../types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(body.message || `请求失败 (${response.status})`);
  }
  return body;
}

export const mirrorApi = {
  devices: () => request<DeviceResponse>('/api/devices'),
  runtime: () => request<RuntimeStatus>('/api/runtime'),
  quickConnect: () => request<QuickConnectInfo>('/api/quick-connect'),
  autoConnect: () => request<ActionResponse>('/api/adb/auto-connect', { method: 'POST' }),
  connect: (address: string) =>
    request<ActionResponse>('/api/adb/connect', {
      method: 'POST',
      body: JSON.stringify({ address }),
    }),
  pair: (address: string, code: string) =>
    request<ActionResponse>('/api/adb/pair', {
      method: 'POST',
      body: JSON.stringify({ address, code }),
    }),
  enableWifi: (serial: string, port = 5555) =>
    request<ActionResponse>('/api/wifi/enable', {
      method: 'POST',
      body: JSON.stringify({ serial, port }),
    }),
  preparePose: (serial: string) =>
    request<ActionResponse>('/api/pose/prepare', {
      method: 'POST',
      body: JSON.stringify({ serial }),
    }),
  calibratePose: () =>
    request<ActionResponse>('/api/pose/calibrate', { method: 'POST' }),
};
