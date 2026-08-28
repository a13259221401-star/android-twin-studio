import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Camera, CameraSlash, PersonSimpleRun } from '@phosphor-icons/react';

const CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32],
] as const;

interface LivePresenterProps {
  onTrackingChange?: (tracking: boolean) => void;
}

export function LivePresenter({ onTrackingChange }: LivePresenterProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastVideoTime = useRef(-1);
  const lastLandmarksRef = useRef<NormalizedLandmark[] | undefined>(undefined);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task', delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
        if (disposed) landmarker.close();
        else {
          landmarkerRef.current = landmarker;
          setModelReady(true);
        }
      } catch {
        setError('人体识别模型加载失败');
      }
    })();
    return () => {
      disposed = true;
      landmarkerRef.current?.close();
    };
  }, []);

  const drawFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(drawFrame);
      return;
    }

    const width = video.videoWidth || 960;
    const height = video.videoHeight || 540;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.save();
    context.clearRect(0, 0, width, height);
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, width, height);
    context.restore();

    let landmarks = lastLandmarksRef.current;
    if (video.currentTime !== lastVideoTime.current) {
      lastVideoTime.current = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      landmarks = result.landmarks[0];
      lastLandmarksRef.current = landmarks;
      onTrackingChange?.(Boolean(landmarks));
    }
    if (landmarks) {
      context.save();
      context.translate(width, 0);
      context.scale(-1, 1);
      context.lineWidth = Math.max(3, width / 260);
      context.lineCap = 'round';
      context.strokeStyle = '#2f8dff';
      context.shadowColor = '#1a75ff';
      context.shadowBlur = 14;
      for (const [from, to] of CONNECTIONS) {
        const a = landmarks[from];
        const b = landmarks[to];
        if (!a || !b || (a.visibility ?? 1) < 0.4 || (b.visibility ?? 1) < 0.4) continue;
        context.beginPath();
        context.moveTo(a.x * width, a.y * height);
        context.lineTo(b.x * width, b.y * height);
        context.stroke();
      }
      context.fillStyle = '#62c6ff';
      for (const point of landmarks.slice(11, 33)) {
        if ((point.visibility ?? 1) < 0.4) continue;
        context.beginPath();
        context.arc(point.x * width, point.y * height, Math.max(4, width / 190), 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
    animationRef.current = requestAnimationFrame(drawFrame);
  };

  const startCamera = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraEnabled(true);
      animationRef.current = requestAnimationFrame(drawFrame);
    } catch {
      setError('未获得摄像头权限，已切换数字人演示');
    }
  };

  const stopCamera = () => {
    cancelAnimationFrame(animationRef.current ?? 0);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    lastLandmarksRef.current = undefined;
    lastVideoTime.current = -1;
    setCameraEnabled(false);
    onTrackingChange?.(false);
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <div className={`presenter-stage ${cameraEnabled ? 'is-live' : ''}`}>
      <video ref={videoRef} muted playsInline />
      <canvas ref={canvasRef} className="presenter-canvas" />
      {!cameraEnabled ? <img className="presenter-fallback" src="/digital-presenter.png" alt="数字人演示员" /> : null}
      <div className="presenter-status">
        <PersonSimpleRun size={16} weight="fill" />
        <span>{cameraEnabled ? '真人骨骼追踪中' : modelReady ? '数字人待机' : '正在载入动作模型'}</span>
      </div>
      <button className="camera-toggle" type="button" onClick={cameraEnabled ? stopCamera : () => void startCamera()}>
        {cameraEnabled ? <CameraSlash size={18} /> : <Camera size={18} />}
        {cameraEnabled ? '关闭真人模式' : '开启真人模式'}
      </button>
      {error ? <div className="camera-error">{error}</div> : null}
    </div>
  );
}
