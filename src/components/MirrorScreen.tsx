import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useApkScreenStream, type ApkScreenStatus } from '../hooks/useApkScreenStream';
import { useUsbScreenStream } from '../hooks/useUsbScreenStream';

interface MirrorScreenProps {
  geometry: THREE.BufferGeometry;
  deviceId?: string;
  usbActive: boolean;
  usbMode: boolean;
  onScreenStatusChange?: (status: ApkScreenStatus) => void;
}

export function MirrorScreen({ geometry, deviceId, usbActive, usbMode, onScreenStatusChange }: MirrorScreenProps) {
  const apkStream = useApkScreenStream(usbMode ? undefined : onScreenStatusChange, !usbMode);
  const usbStream = useUsbScreenStream({
    active: usbMode && usbActive,
    deviceId,
    onStatusChange: usbMode ? onScreenStatusChange : undefined,
  });
  const canvas = usbMode ? usbStream.canvas : apkStream.canvas;
  const texture = useMemo(() => {
    const value = new THREE.CanvasTexture(canvas);
    value.colorSpace = THREE.SRGBColorSpace;
    value.minFilter = THREE.LinearFilter;
    value.magFilter = THREE.LinearFilter;
    value.generateMipmaps = false;
    return value;
  }, [canvas]);

  useFrame(() => {
    texture.needsUpdate = true;
  });

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry} position={[0, -0.016, 0.045]}>
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.FrontSide} />
    </mesh>
  );
}
