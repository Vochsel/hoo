import { Suspense, useEffect, Component, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Sky, ContactShadows, Environment } from '@react-three/drei'
import { useVillage } from './village-context'
import { VillageWorld } from './village-world'
import { HouseInterior } from './house-interior'
import { FPSCameraController } from './fps-camera-controller'
import { SimsCameraController } from './sims-camera-controller'
import { ProceduralClouds } from './procedural-clouds'
import { useHubWorldLighting } from '@/hooks/use-hub-world-lighting'

/* ------------------------------------------------------------------ */
/*  Error boundary                                                     */
/* ------------------------------------------------------------------ */

interface ErrorBoundaryProps { fallback?: ReactNode; children: ReactNode }
interface ErrorBoundaryState { hasError: boolean }

class SceneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) { console.warn('[VillageScene] caught:', error.message) }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}

/* ------------------------------------------------------------------ */
/*  Indoor helpers                                                     */
/* ------------------------------------------------------------------ */

function IndoorEnvironmentClear({ active }: { active: boolean }) {
  const { scene } = useThree()
  useEffect(() => {
    if (active) { scene.environment = null }
  }, [active, scene])
  return null
}

/* ------------------------------------------------------------------ */
/*  Scene content (lives inside Canvas)                                */
/* ------------------------------------------------------------------ */

function SceneContent() {
  const { location, cameraMode } = useVillage()
  const lighting = useHubWorldLighting()
  const isIndoor = location.type === 'indoor'

  return (
    <>
      <color attach="background" args={[isIndoor ? '#1a1a1a' : lighting.backgroundColor]} />

      {/* Outdoor lighting — hidden when indoors */}
      <group visible={!isIndoor}>
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
        <ProceduralClouds
          sunPosition={lighting.sunPosition}
          daylight={lighting.daylightFactor}
        />
      </group>

      <IndoorEnvironmentClear active={isIndoor} />

      <ambientLight
        intensity={isIndoor ? 1.0 : lighting.ambientIntensity}
        color="#ffffff"
      />

      {/* Outdoor village */}
      <group visible={!isIndoor}>
        <VillageWorld nightFactor={lighting.nightFactor} />
      </group>

      {/* Indoor house */}
      {isIndoor && (
        <HouseInterior boardId={location.boardId} />
      )}

      {/* Camera controller */}
      {cameraMode === 'fps' && <FPSCameraController />}
      {cameraMode === 'sims' && <SimsCameraController />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Exported scene                                                     */
/* ------------------------------------------------------------------ */

export function VillageScene() {
  const lighting = useHubWorldLighting()

  return (
    <SceneErrorBoundary fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">3D scene failed to load. Try refreshing.</div>}>
      <Canvas
        shadows
        camera={{ fov: 70, near: 0.1, far: 500 }}
        style={{ background: lighting.backgroundColor }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </SceneErrorBoundary>
  )
}
