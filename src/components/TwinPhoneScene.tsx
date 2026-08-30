import { ContactShadows, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ApkScreenStatus } from '../hooks/useApkScreenStream';
import type { MotionPose } from '../types';
import { MirrorScreen } from './MirrorScreen';

interface TwinPhoneSceneProps {
  pose: MotionPose;
  poseEnabled: boolean;
  smoothing: number;
  deviceId?: string;
  streaming: boolean;
  runtimeUrl: string;
  connectionMode: 'apk' | 'usb';
  frameColor: 'emerald' | 'iceblue' | 'graphite' | 'gold' | 'silver';
  viewMode: 'live' | 'showcase';
  onApkScreenStatusChange?: (status: ApkScreenStatus) => void;
}

const FRAME_COLORS = {
  emerald: '#07945a',
  iceblue: '#91a7b7',
  graphite: '#3b3d40',
  gold: '#aa8a69',
  silver: '#b8b7b2',
};

const BACK_COLORS = {
  emerald: '#064b37',
  iceblue: '#708999',
  graphite: '#202326',
  gold: '#7f6954',
  silver: '#91918d',
};

const CAMERA_ISLAND_COLORS = {
  emerald: '#086244',
  iceblue: '#7d96a6',
  graphite: '#2d3033',
  gold: '#92775d',
  silver: '#a5a49f',
};

function roundedRectangle(path: THREE.Shape | THREE.Path, width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  path.moveTo(x + radius, y);
  path.lineTo(x + width - radius, y);
  path.quadraticCurveTo(x + width, y, x + width, y + radius);
  path.lineTo(x + width, y + height - radius);
  path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  path.lineTo(x + radius, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - radius);
  path.lineTo(x, y + radius);
  path.quadraticCurveTo(x, y, x + radius, y);
}

function CameraLens({ position, frameColor }: { position: [number, number, number]; frameColor: TwinPhoneSceneProps['frameColor'] }) {
  const ring = FRAME_COLORS[frameColor];

  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.145, 0.145, 0.018, 48]} />
        <meshPhysicalMaterial color={ring} metalness={0.88} roughness={0.14} clearcoat={1} clearcoatRoughness={0.06} />
      </mesh>
      <mesh position={[0, 0, -0.015]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.116, 0.116, 0.016, 48]} />
        <meshPhysicalMaterial color="#07100e" metalness={0.22} roughness={0.12} clearcoat={1} clearcoatRoughness={0.025} />
      </mesh>
      <mesh position={[0, 0, -0.025]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.076, 0.076, 0.006, 48]} />
        <meshPhysicalMaterial color="#071b22" metalness={0.35} roughness={0.08} clearcoat={1} clearcoatRoughness={0.01} />
      </mesh>
      <mesh position={[-0.025, 0.025, -0.032]}>
        <sphereGeometry args={[0.019, 20, 12]} />
        <meshPhysicalMaterial color="#82b8e7" emissive="#3477ad" emissiveIntensity={0.28} roughness={0.05} />
      </mesh>
    </group>
  );
}

function RearDetails({ frameColor }: { frameColor: TwinPhoneSceneProps['frameColor'] }) {
  const island = CAMERA_ISLAND_COLORS[frameColor];
  const accent = FRAME_COLORS[frameColor];

  return (
    <group>
      <RoundedBox args={[0.66, 0.76, 0.022]} radius={0.105} smoothness={7} position={[0.405, 1.12, -0.055]}>
        <meshPhysicalMaterial color={island} metalness={0.48} roughness={0.19} clearcoat={0.94} clearcoatRoughness={0.08} />
      </RoundedBox>

      <CameraLens position={[0.56, 1.3, -0.074]} frameColor={frameColor} />
      <CameraLens position={[0.56, 0.99, -0.074]} frameColor={frameColor} />
      <CameraLens position={[0.27, 1.145, -0.074]} frameColor={frameColor} />

      <mesh position={[0.255, 1.36, -0.071]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.052, 32]} />
        <meshPhysicalMaterial color="#f4e5bd" emissive="#fff4cf" emissiveIntensity={0.3} roughness={0.24} clearcoat={0.75} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0.255, 0.95, -0.073]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.019, 24]} />
        <meshPhysicalMaterial color="#101b18" metalness={0.34} roughness={0.2} side={THREE.DoubleSide} />
      </mesh>

      <group position={[0, -0.03, -0.047]} rotation={[0, Math.PI, 0]}>
        <mesh position={[-0.038, 0.038, 0]} rotation={[0, 0, 0.56]} scale={[0.72, 1, 1]}>
          <torusGeometry args={[0.094, 0.014, 16, 48]} />
          <meshPhysicalMaterial color={accent} metalness={0.54} roughness={0.26} clearcoat={0.72} />
        </mesh>
        <mesh position={[0.038, -0.038, -0.001]} rotation={[0, 0, 0.56]} scale={[0.72, 1, 1]}>
          <torusGeometry args={[0.094, 0.014, 16, 48]} />
          <meshPhysicalMaterial color={accent} metalness={0.54} roughness={0.26} clearcoat={0.72} />
        </mesh>
      </group>

      <RoundedBox args={[0.36, 0.008, 0.005]} radius={0.004} smoothness={4} position={[0, -1.29, -0.047]}>
        <meshPhysicalMaterial color={accent} metalness={0.75} roughness={0.2} />
      </RoundedBox>
    </group>
  );
}

function PhoneTwin({ pose, poseEnabled, smoothing, frameColor, viewMode, deviceId, streaming, connectionMode, onApkScreenStatusChange }: TwinPhoneSceneProps) {
  const phone = useRef<THREE.Group>(null);
  const stablePose = useRef(new THREE.Quaternion());
  const targetPose = useRef(new THREE.Quaternion());
  const sensorWorldToThree = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), []);
  const displayTilt = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.045, 0.76, -0.025, 'YXZ')), []);
  const chassisGeometry = useMemo(() => {
    const outer = new THREE.Shape();
    const opening = new THREE.Path();
    roundedRectangle(outer, 1.56, 3.24, 0.165);
    roundedRectangle(opening, 1.475, 3.145, 0.135);
    outer.holes.push(opening);
    const geometry = new THREE.ExtrudeGeometry(outer, {
      depth: 0.068,
      bevelEnabled: true,
      bevelSize: 0.009,
      bevelThickness: 0.009,
      bevelSegments: 4,
      curveSegments: 18,
      steps: 1,
    });
    geometry.translate(0, 0, -0.034);
    geometry.computeVertexNormals();
    return geometry;
  }, []);
  const backGlassGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    roundedRectangle(shape, 1.472, 3.142, 0.136);
    return new THREE.ShapeGeometry(shape, 24);
  }, []);
  const screenGeometry = useMemo(() => {
    const width = 1.475;
    const height = 3.145;
    const shape = new THREE.Shape();
    roundedRectangle(shape, width, height, 0.135);
    const geometry = new THREE.ShapeGeometry(shape, 24);
    const positions = geometry.getAttribute('position');
    const uvs = geometry.getAttribute('uv');
    for (let index = 0; index < positions.count; index += 1) {
      uvs.setXY(
        index,
        (positions.getX(index) + width / 2) / width,
        (positions.getY(index) + height / 2) / height,
      );
    }
    uvs.needsUpdate = true;
    return geometry;
  }, []);

  useFrame((_, delta) => {
    if (!phone.current) return;
    const tracking = poseEnabled && (pose.tracking === 'TRACKING' || pose.tracking === 'LIMITED');
    const incoming = new THREE.Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w)
      .normalize()
      .premultiply(sensorWorldToThree);
    if (tracking && stablePose.current.angleTo(incoming) > THREE.MathUtils.degToRad(0.3)) stablePose.current.copy(incoming);

    if (viewMode === 'showcase') {
      targetPose.current.copy(displayTilt);
    } else if (tracking) {
      targetPose.current.copy(stablePose.current);
    } else {
      targetPose.current.identity();
    }

    const response = THREE.MathUtils.lerp(17, 4.2, smoothing / 100);
    phone.current.quaternion.slerp(targetPose.current, 1 - Math.exp(-response * delta));

    phone.current.position.x = THREE.MathUtils.damp(phone.current.position.x, 0, response, delta);
    phone.current.position.y = THREE.MathUtils.damp(phone.current.position.y, 0, response, delta);
    phone.current.position.z = THREE.MathUtils.damp(phone.current.position.z, 0, response, delta);
  });

  const metal = FRAME_COLORS[frameColor];
  const back = BACK_COLORS[frameColor];

  return (
    <group ref={phone} scale={0.59}>
      <mesh geometry={chassisGeometry}>
        <meshPhysicalMaterial color={metal} metalness={0.76} roughness={0.16} clearcoat={0.96} clearcoatRoughness={0.08} />
      </mesh>

      <mesh geometry={backGlassGeometry} position={[0, 0, -0.043]}>
        <meshPhysicalMaterial
          color={back}
          metalness={0.3}
          roughness={0.34}
          clearcoat={0.74}
          clearcoatRoughness={0.16}
          side={THREE.DoubleSide}
        />
      </mesh>

      <RearDetails frameColor={frameColor} />

      <MirrorScreen
        geometry={screenGeometry}
        deviceId={deviceId}
        usbActive={streaming}
        usbMode={connectionMode === 'usb'}
        onScreenStatusChange={onApkScreenStatusChange}
      />

      <RoundedBox args={[0.014, 0.38, 0.032]} radius={0.006} smoothness={6} position={[-0.787, 0.5, 0]}>
        <meshPhysicalMaterial color={metal} metalness={0.95} roughness={0.18} />
      </RoundedBox>
      <RoundedBox args={[0.014, 0.2, 0.032]} radius={0.006} smoothness={6} position={[-0.787, 0.94, 0]}>
        <meshPhysicalMaterial color={metal} metalness={0.95} roughness={0.18} />
      </RoundedBox>
      <RoundedBox args={[0.014, 0.46, 0.032]} radius={0.006} smoothness={6} position={[0.787, 0.44, 0]}>
        <meshPhysicalMaterial color={metal} metalness={0.95} roughness={0.18} />
      </RoundedBox>
      <RoundedBox args={[0.24, 0.012, 0.026]} radius={0.006} smoothness={6} position={[0, -1.623, 0]}>
        <meshPhysicalMaterial color="#13231d" metalness={0.25} roughness={0.24} />
      </RoundedBox>
    </group>
  );
}

export function TwinPhoneScene(props: TwinPhoneSceneProps) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0.05, 7.05], fov: 30 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={1.45} />
      <directionalLight position={[-4, 6, 6]} intensity={4.3} color="#fffdf8" />
      <directionalLight position={[4, 1, 4]} intensity={2.2} color="#d9e6ff" />
      <pointLight position={[-2.4, -1, 3.5]} intensity={12} distance={8} color="#ffffff" />
      <gridHelper args={[5.5, 12, '#d9d7d1', '#ebe9e4']} position={[0, -1.64, -0.45]} rotation={[0, 0, 0]} />
      <PhoneTwin {...props} />
      <ContactShadows position={[0, -1.62, 0]} opacity={0.2} scale={4.8} blur={3.1} far={3.5} color="#77736c" />
    </Canvas>
  );
}
