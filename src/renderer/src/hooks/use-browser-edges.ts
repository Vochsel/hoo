import { useState, useEffect, useCallback, useRef } from 'react'
import type { Edge } from '@xyflow/react'

export interface BrowserEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
}

export function useBrowserEdges(): {
  edges: Edge[]
  loading: boolean
  refresh: () => Promise<void>
  saveEdges: (edges: Edge[]) => Promise<void>
} {
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const refresh = useCallback(async () => {
    setLoading(true)
    const result: BrowserEdge[] = await window.api.browserEdges.list()
    setEdges(
      result.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const saveEdges = useCallback(async (newEdges: Edge[]) => {
    setEdges(newEdges)
    // Debounced save — 500ms
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      await window.api.browserEdges.save(
        newEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined
        }))
      )
    }, 500)
  }, [])

  useEffect(() => {
    return (): void => {
      clearTimeout(saveTimerRef.current)
    }
  }, [])

  return { edges, loading, refresh, saveEdges }
}
