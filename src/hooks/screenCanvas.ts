export type ScreenStreamStatus = 'waiting' | 'connecting' | 'streaming' | 'unsupported' | 'error';
export type ScreenStreamSource = 'apk' | 'usb';

export const SCREEN_WIDTH = 720;
export const SCREEN_HEIGHT = 1536;

export function createScreenCanvas(source: ScreenStreamSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_WIDTH;
  canvas.height = SCREEN_HEIGHT;
  drawStatus(canvas, 'waiting', source);
  return canvas;
}

export function drawStatus(canvas: HTMLCanvasElement, status: ScreenStreamStatus, source: ScreenStreamSource) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  context.fillStyle = '#f4f3ef';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = source === 'usb' ? '#1d78c1' : '#2b78e4';
  context.font = '500 17px Inter, sans-serif';
  context.fillText(source === 'usb' ? 'USB CABLE STREAM' : 'APK DIRECT STREAM', canvas.width / 2, canvas.height / 2 - 58);
  context.fillStyle = '#33332f';
  context.font = '600 60px Inter, sans-serif';
  const title = status === 'unsupported'
    ? 'UNSUPPORTED'
    : status === 'error'
      ? 'RETRY'
      : status === 'connecting'
        ? 'LINKING'
        : source === 'usb'
          ? 'PLUG IN'
          : 'SCAN';
  context.fillText(title, canvas.width / 2, canvas.height / 2 + 6);
  context.fillStyle = '#99968f';
  context.font = '400 18px "Noto Sans SC", sans-serif';
  const detail = status === 'unsupported'
    ? '当前浏览器不支持实时视频解码'
    : status === 'error'
      ? '画面连接异常，请检查设备授权'
      : status === 'connecting'
        ? source === 'usb' ? '正在通过 ADB 建立有线画面' : '正在等待手机发送关键帧'
        : source === 'usb' ? '连接 USB 手机并点击开始投屏' : '使用 Tracker 扫码并开始实时投屏';
  context.fillText(detail, canvas.width / 2, canvas.height / 2 + 65);
}

export function drawContainedFrame(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || sourceWidth <= 0 || sourceHeight <= 0) return;
  const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  context.fillStyle = '#050505';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, x, y, width, height);
}
