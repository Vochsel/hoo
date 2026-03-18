import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useVillage } from './village-context'

const WALK_SPEED = 6
const RUN_SPEED = 14
const LOOK_SPEED = 0.002
const PLAYER_HEIGHT = 1.7
const INTERACTION_DISTANCE = 3.5
const AUTO_ENTER_DISTANCE = 1.5 // walk into circle to auto-enter
const DOOR_OFFSET_Z = 5

type Interactable = {
  id: string
  pos: THREE.Vector3
  action: 'enter-house' | 'exit-house' | 'use-board'
  boardId: string
}

export function FPSCameraController() {
  const { camera, gl } = useThree()
  const { neighborhoods, location, enterHouse, exitHouse, interact, activeDialog, setHoveredId, savedCameraPos, saveCameraPos } = useVillage()
  const keysRef = useRef(new Set<string>())
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const isLockedRef = useRef(false)
  const velocityYRef = useRef(0)
  const isGroundedRef = useRef(true)
  const autoEnteredRef = useRef<string | null>(null) // prevent re-entry loop

  const interactablesRef = useRef<Interactable[]>([])
  const doorPositionsRef = useRef<{ boardId: string; pos: THREE.Vector3 }[]>([])

  useEffect(() => {
    if (location.type === 'outdoor') {
      const doors: Interactable[] = []
      const doorPositions: { boardId: string; pos: THREE.Vector3 }[] = []
      for (const n of neighborhoods) {
        for (const h of n.houses) {
          const cos = Math.cos(h.worldRotation)
          const sin = Math.sin(h.worldRotation)
          const dx = DOOR_OFFSET_Z * sin
          const dz = DOOR_OFFSET_Z * cos
          const doorPos = new THREE.Vector3(h.worldPosition[0] + dx, 0, h.worldPosition[2] + dz)
          doors.push({ id: `door-${h.id}`, pos: doorPos, action: 'enter-house', boardId: h.id })
          doorPositions.push({ boardId: h.id, pos: doorPos })
        }
      }
      interactablesRef.current = doors
      doorPositionsRef.current = doorPositions
      autoEnteredRef.current = null
    } else {
      // Interior: exit door + agent. Desks are added dynamically via proximity.
      // We use a generic 'scan area' approach — the interior is 30x30, so we
      // register the exit door and the agent. Desk interaction is handled by
      // the house-interior component's layout which we mirror here at runtime.
      const items: Interactable[] = [
        { id: 'exit-door', pos: new THREE.Vector3(0, 0, 6.5), action: 'exit-house', boardId: '' },
        { id: 'interior-agent-0', pos: new THREE.Vector3(2, 0, 2), action: 'use-board', boardId: location.boardId },
      ]
      // Scan for desk positions dynamically from board items
      window.api.browserTabs.list(location.boardId).then((tabs: { id: string }[]) => {
        window.api.graphNodes.list(location.boardId).then((nodes: { id: string; nodeType: string }[]) => {
          const allIds = [
            ...tabs.map((t: { id: string }) => t.id),
            ...nodes.filter((n: { nodeType: string }) => n.nodeType === 'terminal').map((n: { id: string }) => n.id)
          ]
          // Match the random placement in house-interior.tsx
          let seed = 0
          for (let ci = 0; ci < location.boardId.length; ci++) seed = ((seed << 5) - seed + location.boardId.charCodeAt(ci)) | 0
          seed = Math.abs(seed)
          const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
          const placed: [number, number][] = []
          const hs = 8, margin = 2.5
          allIds.forEach((itemId) => {
            for (let attempt = 0; attempt < 20; attempt++) {
              const x = (rng() - 0.5) * (16 - margin * 2 - 2)
              const z = -hs + margin + rng() * (16 - margin * 2 - 4)
              const tooClose = placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < 2.8)
              if (!tooClose) {
                placed.push([x, z])
                items.push({ id: `desk-${itemId}`, pos: new THREE.Vector3(x, 0, z), action: 'use-board', boardId: location.boardId })
                break
              }
            }
            rng() // consume rotation value to stay in sync
          })
          interactablesRef.current = items
        }).catch(() => {})
      }).catch(() => {})
      interactablesRef.current = items
      doorPositionsRef.current = []
    }
  }, [neighborhoods, location])

  useEffect(() => {
    if (location.type === 'outdoor') {
      // Place player outside the house they just exited
      if (savedCameraPos) {
        // savedCameraPos stores the door world position when we entered
        camera.position.set(savedCameraPos.x, PLAYER_HEIGHT, savedCameraPos.z)
        yawRef.current = savedCameraPos.yaw
      } else {
        camera.position.set(0, PLAYER_HEIGHT, 20)
        yawRef.current = 0
      }
      pitchRef.current = 0
      autoEnteredRef.current = null // allow re-entering after cooldown
      // Re-acquire pointer lock after transition
      setTimeout(() => { gl.domElement.requestPointerLock() }, 50)
    } else {
      // Save the door world position so we can place player there on exit
      // Find the house to get its door position
      let doorX = camera.position.x, doorZ = camera.position.z, doorYaw = yawRef.current
      for (const n of neighborhoods) {
        for (const h of n.houses) {
          if (h.id === location.boardId) {
            const cos = Math.cos(h.worldRotation)
            const sin = Math.sin(h.worldRotation)
            // Door is DOOR_OFFSET_Z in front of house, plus a bit more to stand clear
            const standoff = DOOR_OFFSET_Z + 2
            doorX = h.worldPosition[0] + sin * standoff
            doorZ = h.worldPosition[2] + cos * standoff
            // Face away from house (opposite of house facing direction)
            doorYaw = h.worldRotation + Math.PI
          }
        }
      }
      saveCameraPos({ x: doorX, y: PLAYER_HEIGHT, z: doorZ, yaw: doorYaw })
      // Enter house: face INTO the room (toward back wall = -Z = yaw 0)
      camera.position.set(0, PLAYER_HEIGHT, 5)
      yawRef.current = 0
      pitchRef.current = 0
      // Re-acquire pointer lock after transition
      setTimeout(() => { gl.domElement.requestPointerLock() }, 50)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.code)
      if (e.code === 'Space' && isGroundedRef.current) {
        velocityYRef.current = 6
        isGroundedRef.current = false
      }
      if (e.code === 'KeyE') {
        const cam2D = new THREE.Vector2(camera.position.x, camera.position.z)
        let nearest: Interactable | null = null
        let nearestDist = INTERACTION_DISTANCE
        for (const ia of interactablesRef.current) {
          const d = cam2D.distanceTo(new THREE.Vector2(ia.pos.x, ia.pos.z))
          if (d < nearestDist) { nearestDist = d; nearest = ia }
        }
        if (nearest) {
          if (nearest.action === 'enter-house') enterHouse(nearest.boardId)
          else if (nearest.action === 'exit-house') exitHouse()
          else if (nearest.action === 'use-board') interact(nearest.id, 'board', nearest.boardId)
        }
        if (isLockedRef.current) document.exitPointerLock()
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code)
    const handleMouseMove = (e: MouseEvent) => {
      if (!isLockedRef.current) return
      yawRef.current -= e.movementX * LOOK_SPEED
      pitchRef.current -= e.movementY * LOOK_SPEED
      pitchRef.current = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitchRef.current))
    }
    const handlePointerLockChange = () => {
      isLockedRef.current = document.pointerLockElement === gl.domElement
    }
    const handleClick = () => {
      if (!isLockedRef.current) gl.domElement.requestPointerLock()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('pointerlockchange', handlePointerLockChange)
    gl.domElement.addEventListener('click', handleClick)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      gl.domElement.removeEventListener('click', handleClick)
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock()
    }
  }, [camera, gl, location, enterHouse, exitHouse, interact])

  useFrame((_, delta) => {
    const keys = keysRef.current
    const isRunning = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const speed = isRunning ? RUN_SPEED : WALK_SPEED

    const forward = new THREE.Vector3(-Math.sin(yawRef.current), 0, -Math.cos(yawRef.current))
    const right = new THREE.Vector3(Math.cos(yawRef.current), 0, -Math.sin(yawRef.current))
    const velocity = new THREE.Vector3()
    if (keys.has('KeyW') || keys.has('ArrowUp')) velocity.add(forward)
    if (keys.has('KeyS') || keys.has('ArrowDown')) velocity.sub(forward)
    if (keys.has('KeyA') || keys.has('ArrowLeft')) velocity.sub(right)
    if (keys.has('KeyD') || keys.has('ArrowRight')) velocity.add(right)
    if (velocity.lengthSq() > 0) {
      velocity.normalize().multiplyScalar(speed * delta)
      camera.position.add(velocity)
    }

    if (location.type === 'indoor') {
      camera.position.x = Math.max(-7.5, Math.min(7.5, camera.position.x))
      camera.position.z = Math.max(-7.5, Math.min(7.5, camera.position.z))
    }

    velocityYRef.current -= 15 * delta
    camera.position.y += velocityYRef.current * delta
    if (camera.position.y <= PLAYER_HEIGHT) {
      camera.position.y = PLAYER_HEIGHT
      velocityYRef.current = 0
      isGroundedRef.current = true
    }
    camera.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ'))

    // Highlight nearest interactable
    const cam2D = new THREE.Vector2(camera.position.x, camera.position.z)
    let nearestId: string | null = null
    let nearestDist = INTERACTION_DISTANCE
    for (const ia of interactablesRef.current) {
      const d = cam2D.distanceTo(new THREE.Vector2(ia.pos.x, ia.pos.z))
      if (d < nearestDist) { nearestDist = d; nearestId = ia.id }
    }
    setHoveredId(nearestId)

    // Auto-enter house when walking into the door circle
    if (location.type === 'outdoor') {
      for (const door of doorPositionsRef.current) {
        const d = cam2D.distanceTo(new THREE.Vector2(door.pos.x, door.pos.z))
        if (d < AUTO_ENTER_DISTANCE && autoEnteredRef.current !== door.boardId) {
          autoEnteredRef.current = door.boardId
          enterHouse(door.boardId)
          break
        }
      }
    }

    // Auto-exit house when walking into the exit door circle
    if (location.type === 'indoor') {
      const exitDoorPos = new THREE.Vector2(0, 6.5)
      const d = cam2D.distanceTo(exitDoorPos)
      if (d < AUTO_ENTER_DISTANCE) {
        exitHouse()
      }
    }
  })

  return null
}
