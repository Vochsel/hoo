import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useVillage } from './village-context'

const PAN_SPEED = 0.004
const EDGE_PAN_ZONE = 60
const EDGE_PAN_SPEED = 8
const CLICK_DISTANCE_THRESHOLD = 4 // mouse must not move more than 4px to count as click
const DOOR_OFFSET_Z = 5

type ClickTarget = {
  id: string
  pos: THREE.Vector3
  action: 'enter-house' | 'exit-house' | 'use-board'
  boardId: string
}

export function SimsCameraController() {
  const { camera, gl } = useThree()
  const { neighborhoods, location, enterHouse, exitHouse, interact } = useVillage()
  const isDraggingRef = useRef(false)
  const lastMouseRef = useRef({ x: 0, y: 0 })
  const mouseDownRef = useRef({ x: 0, y: 0 })
  const mouseScreenRef = useRef({ x: 0, y: 0 })
  const targetRef = useRef(new THREE.Vector3())
  const distRef = useRef(30)

  // Click targets for raycast-based interaction
  const clickTargetsRef = useRef<ClickTarget[]>([])
  useEffect(() => {
    if (location.type === 'outdoor') {
      clickTargetsRef.current = neighborhoods.flatMap((n) =>
        n.houses.map((h) => {
          const cos = Math.cos(h.worldRotation)
          const sin = Math.sin(h.worldRotation)
          const dx = DOOR_OFFSET_Z * sin
          const dz = DOOR_OFFSET_Z * cos
          return {
            id: `door-${h.id}`,
            pos: new THREE.Vector3(h.worldPosition[0] + dx, 0, h.worldPosition[2] + dz),
            action: 'enter-house' as const,
            boardId: h.id
          }
        })
      )
    } else {
      const items: ClickTarget[] = [
        { id: 'exit-door', pos: new THREE.Vector3(0, 0, 6.5), action: 'exit-house', boardId: '' },
        { id: 'interior-agent-0', pos: new THREE.Vector3(2, 0, 2), action: 'use-board', boardId: location.boardId },
      ]
      clickTargetsRef.current = items
      // Load desk targets from board data
      Promise.all([
        window.api.browserTabs.list(location.boardId) as Promise<{ id: string }[]>,
        window.api.graphNodes.list(location.boardId) as Promise<{ id: string; nodeType: string }[]>
      ]).then(([tabs, nodes]) => {
        const allIds = [
          ...tabs.map((t) => t.id),
          ...nodes.filter((n) => n.nodeType === 'terminal').map((n) => n.id)
        ]
        // Reproduce the same seeded random placement as house-interior.tsx
        let seed = 0
        for (let ci = 0; ci < location.boardId.length; ci++) seed = ((seed << 5) - seed + location.boardId.charCodeAt(ci)) | 0
        seed = Math.abs(seed)
        const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
        const placed: [number, number][] = []
        const hs = 8, margin = 2.5
        const updated = [...items]
        allIds.forEach((itemId) => {
          for (let attempt = 0; attempt < 20; attempt++) {
            const x = (rng() - 0.5) * (16 - margin * 2 - 2)
            const z = -hs + margin + rng() * (16 - margin * 2 - 4)
            const tooClose = placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < 2.8)
            if (!tooClose) {
              placed.push([x, z])
              updated.push({ id: `desk-${itemId}`, pos: new THREE.Vector3(x, 0, z), action: 'use-board', boardId: location.boardId })
              break
            }
          }
          rng() // consume rotation to stay in sync with house-interior.tsx
        })
        clickTargetsRef.current = updated
      }).catch(() => {})
    }
  }, [neighborhoods, location])

  useEffect(() => {
    if (location.type === 'indoor') {
      targetRef.current.set(0, 0, 0)
      distRef.current = 12
    } else if (neighborhoods.length > 0) {
      let cx = 0, cz = 0, count = 0
      for (const n of neighborhoods) { cx += n.position[0]; cz += n.position[2]; count++ }
      targetRef.current.set(cx / count, 0, cz / count)
      distRef.current = 30 + neighborhoods.length * 3
    }

    const d = distRef.current
    camera.position.set(targetRef.current.x, d, targetRef.current.z + d * 0.6)
    camera.lookAt(targetRef.current)

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 1) {
        isDraggingRef.current = true
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
        mouseDownRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const handleMouseUp = (e: MouseEvent) => {
      const wasDrag = isDraggingRef.current
      isDraggingRef.current = false

      // Check if this was a click (not a drag)
      if (wasDrag) {
        const dx = e.clientX - mouseDownRef.current.x
        const dy = e.clientY - mouseDownRef.current.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < CLICK_DISTANCE_THRESHOLD) {
          handleClick(e)
        }
      }
    }
    const handleMouseMove = (e: MouseEvent) => {
      mouseScreenRef.current = { x: e.clientX, y: e.clientY }
      if (isDraggingRef.current) {
        const dx = e.clientX - lastMouseRef.current.x
        const dy = e.clientY - lastMouseRef.current.y
        const scale = PAN_SPEED * distRef.current
        targetRef.current.x -= dx * scale
        targetRef.current.z -= dy * scale
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const handleWheel = (e: WheelEvent) => {
      const zoomDelta = e.deltaY * 0.002 * distRef.current
      distRef.current = Math.max(8, Math.min(100, distRef.current + zoomDelta))
    }

    // Click: raycast to ground plane, find nearest click target
    const handleClick = (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, camera)

      // Intersect with ground plane (y=0)
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const hitPoint = new THREE.Vector3()
      raycaster.ray.intersectPlane(groundPlane, hitPoint)

      if (hitPoint) {
        // Find nearest click target to the hit point
        let nearest: ClickTarget | null = null
        let nearestDist = 6 // max click range on ground
        for (const ct of clickTargetsRef.current) {
          const d = hitPoint.distanceTo(ct.pos)
          if (d < nearestDist) { nearestDist = d; nearest = ct }
        }
        if (nearest) {
          if (nearest.action === 'enter-house') enterHouse(nearest.boardId)
          else if (nearest.action === 'exit-house') exitHouse()
          else if (nearest.action === 'use-board') interact(nearest.id, 'board', nearest.boardId)
        }
      }
    }

    const el = gl.domElement
    el.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('mousemove', handleMouseMove)
    el.addEventListener('wheel', handleWheel, { passive: true })
    return () => {
      el.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('mousemove', handleMouseMove)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [camera, gl, neighborhoods, location, enterHouse, exitHouse, interact])

  useFrame((_, delta) => {
    const rect = gl.domElement.getBoundingClientRect()
    const mx = mouseScreenRef.current.x - rect.left
    const my = mouseScreenRef.current.y - rect.top
    const w = rect.width
    const h = rect.height

    if (!isDraggingRef.current) {
      const speed = EDGE_PAN_SPEED * delta * (distRef.current / 20)
      if (mx < EDGE_PAN_ZONE) targetRef.current.x -= speed * (1 - mx / EDGE_PAN_ZONE)
      if (mx > w - EDGE_PAN_ZONE) targetRef.current.x += speed * (1 - (w - mx) / EDGE_PAN_ZONE)
      if (my < EDGE_PAN_ZONE) targetRef.current.z -= speed * (1 - my / EDGE_PAN_ZONE)
      if (my > h - EDGE_PAN_ZONE) targetRef.current.z += speed * (1 - (h - my) / EDGE_PAN_ZONE)
    }

    const d = distRef.current
    camera.position.set(targetRef.current.x, d, targetRef.current.z + d * 0.6)
    camera.lookAt(targetRef.current)
  })

  return null
}
