import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function startMirrorRuntime(workspaceRoot: string): Promise<string> {
  const script = path.join(workspaceRoot, 'scripts', 'start-mirror-runtime.ps1');
  await access(script);
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  try {
    const { stdout, stderr } = await execFileAsync(
      powershell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { cwd: workspaceRoot, windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 },
    );
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    const details = error as Error & { stdout?: string; stderr?: string };
    throw new Error((details.stderr || details.stdout || details.message || 'USB 投屏运行时启动失败').trim());
  }
}
