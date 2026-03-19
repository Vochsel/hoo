import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Sky, ContactShadows, Environment } from '@react-three/drei'
import { useVillage } from './village-context'
import { VillageWorld } from './village-world'
import { HouseInterior } from './house-interior'
import { FPSCameraController } from './fps-camera-controller'
import { SimsCameraController } from './sims-camera-controller'
import { ProceduralClouds } from './procedural-clouds'
import { useHubWorldLighting } from '@/hooks/use-hub-world-lighting'

export function VillageScene() {
  const { location, cameraMode } = useVillage()
  const lighting = useHubWorldLighting()

  return (
    <Canvas
      shadows
      camera={{ fov: 70, near: 0.1, far: 500 }}
      style={{ background: lighting.backgroundColor }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={[lighting.backgroundColor]} />
        <Sky
          sunPosition={lighting.sunPosition}
          turbidity={lighting.skyTurbidity}
          rayleigh={lighting.skyRayleigh}
          mieCoefficient={lighting.skyMieCoefficient}
          mieDirectionalG={lighting.skyMieDirectionalG}
        />
        <Environment
          files="/hub-assets/suburban_garden_1k.hdr"
          background={false}
          environmentIntensity={lighting.environmentIntensity}
        />
        <ambientLight intensity={lighting.ambientIntensity} />
        <directionalLight
          position={lighting.directionalPosition}
          intensity={lighting.directionalIntensity}
          color={lighting.directionalColor}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-60}
          shadow-camera-right={60}
          shadow-camera-top={60}
          shadow-camera-bottom={-60}
        />
        <hemisphereLight
          args={[
            lighting.hemisphereSkyColor,
            lighting.hemisphereGroundColor,
            lighting.hemisphereIntensity
          ]}
        />
        <fog attach="fog" args={[lighting.fogColor, 30, 120]} />

        <ContactShadows
          position={[0, 0.01, 0]}
          opacity={lighting.shadowOpacity}
          scale={150}
          blur={2.5}
          far={15}
        />

        {/* Procedural cloud dome */}
        <ProceduralClouds
          sunPosition={lighting.sunPosition}
          daylight={lighting.daylightFactor}
        />

        {/* Outdoor village - hidden when indoors */}
        <group visible={location.type === 'outdoor'}>
          <VillageWorld nightFactor={lighting.nightFactor} />
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
