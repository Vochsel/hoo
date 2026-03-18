import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Sky, ContactShadows, Environment } from '@react-three/drei'
import { useVillage } from './village-context'
import { VillageWorld } from './village-world'
import { HouseInterior } from './house-interior'
import { FPSCameraController } from './fps-camera-controller'
import { SimsCameraController } from './sims-camera-controller'

export function VillageScene() {
  const { location, cameraMode } = useVillage()

  return (
    <Canvas
      shadows
      camera={{ fov: 70, near: 0.1, far: 500 }}
      style={{ background: '#87CEEB' }}
    >
      <Suspense fallback={null}>
        <Sky sunPosition={[100, 20, 100]} />
        <Environment
          files="/hub-assets/suburban_garden_1k.hdr"
          background={false}
          environmentIntensity={0.6}
        />
        <ambientLight intensity={0.2} />
        <directionalLight
          position={[50, 50, 25]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
        />
        <hemisphereLight args={['#87CEEB', '#4a7c59', 0.15]} />
        <fog attach="fog" args={['#87CEEB', 30, 120]} />

        <ContactShadows position={[0, 0.01, 0]} opacity={0.3} scale={150} blur={2.5} far={15} />

        {/* Outdoor village - hidden when indoors */}
        <group visible={location.type === 'outdoor'}>
          <VillageWorld />
        </group>

        {/* Indoor house - shown when entered */}
        {location.type === 'indoor' && (
          <HouseInterior boardId={location.boardId} />
        )}

        {/* Camera controller based on mode */}
        {cameraMode === 'fps' && <FPSCameraController />}
        {cameraMode === 'sims' && <SimsCameraController />}
      </Suspense>
    </Canvas>
  )
}
