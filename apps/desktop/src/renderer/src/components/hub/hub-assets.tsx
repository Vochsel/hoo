import { useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import * as THREE from 'three'

/* ------------------------------------------------------------------ */
/*  Asset catalog – maps logical names to GLB files and default scale  */
/* ------------------------------------------------------------------ */

export interface AssetDef {
  file: string
  scale: number
  yawOffset?: number // extra Y rotation to correct model facing direction
  keepMaterial?: boolean // don't override with village texture
}

// Houses (folders)
export const HOUSE_ASSETS: AssetDef[] = [
  { file: 'house.glb', scale: 3.5 },
  { file: 'house_blue.glb', scale: 3.5 },
  { file: 'house_red.glb', scale: 3.5 },
  { file: 'house_purple.glb', scale: 3.5 },
  { file: 'house_2story_purple.glb', scale: 3.0, yawOffset: Math.PI / 2 },
  { file: 'barn.glb', scale: 2.5 },
  { file: 'chapel.glb', scale: 2.5 },
  { file: 'windmill.glb', scale: 1.5 },
]

// Trees
export const TREE_ASSETS: AssetDef[] = [
  { file: 'tree_pine.glb', scale: 4.0 },
  { file: 'treetall.glb', scale: 4.5 },
  { file: 'tree_square.glb', scale: 4.0 },
]

// Town decorations (scattered around outdoors)
export const OUTDOOR_PROPS: AssetDef[] = [
  { file: 'bench.glb', scale: 3.0 },
  { file: 'barrell.glb', scale: 3.0 },
  { file: 'boulder.glb', scale: 2.5 },
  { file: 'crate.glb', scale: 3.0 },
  { file: 'streetlight.glb', scale: 3.0 },
  { file: 'well.glb', scale: 3.0 },
  { file: 'hay_bale.glb', scale: 3.0 },
  { file: 'hay_cart.glb', scale: 2.5 },
  { file: 'potted_bush.glb', scale: 3.0 },
  { file: 'fence.glb', scale: 3.0 },
  { file: 'pillar.glb', scale: 3.5 },
]

// Small decorative items
export const SMALL_PROPS: AssetDef[] = [
  { file: 'daisy.glb', scale: 4.0 },
  { file: 'shroom.glb', scale: 3.0 },
]

// Indoor furniture (for sims rooms)
export const INDOOR_PROPS: AssetDef[] = [
  { file: 'bench.glb', scale: 2.5 },
  { file: 'barrell.glb', scale: 2.5 },
  { file: 'crate.glb', scale: 2.5 },
  { file: 'potted_bush.glb', scale: 2.5 },
  { file: 'picnic_table.glb', scale: 3.0 },
]

// Computer (for house interiors - tabs/terminals)
export const COMPUTER_ASSET: AssetDef = { file: 'computer.glb', scale: 1.5, keepMaterial: true }

/* ------------------------------------------------------------------ */
/*  GLB model component                                                */
/* ------------------------------------------------------------------ */

const BASE_PATH = '/hub-assets/'

interface GlbModelProps {
  asset: AssetDef
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
}

export function GlbModel({ asset, position = [0, 0, 0], rotation = [0, 0, 0], scale }: GlbModelProps) {
  const gltf = useLoader(GLTFLoader, BASE_PATH + asset.file)
  const texture = useLoader(THREE.TextureLoader, BASE_PATH + 'texture.png')

  const scene = useMemo(() => {
    const cloned = gltf.scene.clone()
    texture.flipY = false
    texture.colorSpace = THREE.SRGBColorSpace
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true
        if (!asset.keepMaterial) {
          mesh.material = new THREE.MeshStandardMaterial({
            map: texture,
            metalness: 0,
            roughness: 0.82,
          })
        }
      }
    })
    return cloned
  }, [gltf.scene, texture, asset.keepMaterial])

  const s = scale ?? asset.scale
  const yaw = asset.yawOffset ?? 0
  const finalRotation: [number, number, number] = [rotation[0], rotation[1] + yaw, rotation[2]]

  return (
    <primitive
      object={scene}
      position={position}
      rotation={finalRotation}
      scale={[s, s, s]}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Seeded random helpers for deterministic placement                   */
/* ------------------------------------------------------------------ */

export function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function pickAsset<T>(assets: T[], rng: () => number): T {
  return assets[Math.floor(rng() * assets.length)]
}
