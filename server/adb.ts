import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AdbDevice {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  transportId?: string;
  connection: 'wifi' | 'usb';
}

function workspaceRoot(): string {
  return path.resolve(import.meta.dirname, '..');
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function locateAdb(): Promise<string> {
  const candidates = [
    process.env.ANDROID_ADB_PATH,
    path.join(workspaceRoot(), '.runtime', 'ws-scrcpy-web', 'dependencies', 'adb', 'adb.exe'),
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'WsScrcpyWeb', 'dependencies', 'adb', 'adb.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }

  try {
    const { stdout } = await execFileAsync('where.exe', ['adb.exe'], { windowsHide: true, timeout: 3000 });
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (first) return first;
  } catch {
    // The actionable error below includes every supported resolution path.
  }

  throw new Error('未找到 ADB。请先执行 npm run runtime:install，或设置 ANDROID_ADB_PATH。');
}

export async function runAdb(args: string[], timeout = 15000): Promise<string> {
  const adbPath = await locateAdb();
  try {
    const { stdout, stderr } = await execFileAsync(adbPath, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    const details = error as Error & { stdout?: string; stderr?: string };
    throw new Error((details.stderr || details.stdout || details.message || 'ADB 命令失败').trim());
  }
}

export function parseDevices(output: string): AdbDevice[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state = 'unknown', ...attributes] = line.split(/\s+/);
      const values = Object.fromEntries(
        attributes
          .map((attribute) => attribute.split(/:(.*)/s))
          .filter((parts) => parts.length >= 2 && parts[0]),
      );
      return {
        serial,
        state,
        model: values.model?.replaceAll('_', ' '),
        product: values.product,
        transportId: values.transport_id,
        connection: serial.includes(':') || serial.includes('_adb-tls-connect') ? 'wifi' : 'usb',
      } satisfies AdbDevice;
    });
}

export async function listDevices(): Promise<{ adbPath: string; devices: AdbDevice[] }> {
  const adbPath = await locateAdb();
  const output = await runAdb(['devices', '-l']);
  return { adbPath, devices: parseDevices(output) };
}

export function validateEndpoint(input: unknown, defaultPort?: number): string {
  if (typeof input !== 'string') throw new Error('连接地址不能为空');
  let value = input.trim();
  if (defaultPort && !value.includes(':')) value = `${value}:${defaultPort}`;
  if (value.length > 260 || /[\s/\\;&|`$<>]/.test(value)) throw new Error('连接地址格式无效');

  const bracketedIpv6 = /^\[[0-9a-fA-F:]+\]:(\d{1,5})$/;
  const hostAndPort = /^(?:[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*|\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;
  const match = value.match(bracketedIpv6) || value.match(hostAndPort);
  if (!match) throw new Error('请输入“手机 IP:端口”，例如 192.168.1.8:5555');
  const port = Number(match[1]);
  if (port < 1 || port > 65535) throw new Error('端口必须在 1 到 65535 之间');
  return value;
}

export function extractWlanAddress(output: string): string | undefined {
  return output.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//)?.[1];
}
