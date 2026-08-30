export type DeviceState = 'device' | 'offline' | 'unauthorized' | string;

export interface AndroidDevice {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  transportId?: string;
  connection: 'wifi' | 'usb';
}

export interface DeviceResponse {
  adbPath: string;
  devices: AndroidDevice[];
}

export interface ActionResponse {
  ok: boolean;
  message: string;
  serial?: string;
  address?: string;
}

export interface RuntimeStatus {
  ready: boolean;
  url: string;
}

export interface QuickConnectInfo {
  available: boolean;
  host: string;
  port: number;
  websocketUrl: string;
  payload: string;
}

export interface MotionPose {
  type?: 'pose';
  seq: number;
  timestamp: number;
  tracking: 'TRACKING' | 'LIMITED' | 'CALIBRATING' | 'STOPPED';
  mode: 'SENSOR_3DOF';
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  acceleration?: { x: number; y: number; z: number };
  fps?: number;
}
