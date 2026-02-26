import { useState, useEffect, useCallback, useRef } from 'react'
import type { Edge } from '@xyflow/react'

export interface BrowserEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
}

export function useBrowserEdges(boardId: string | null): {
  edges: Edge[]
  loading: boolean
  refresh: () => Promise<void>
  saveEdges: (edges: Edge[]) => Promise<void>
} {
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const boardIdRef = useRef<string | null>(boardId)
  const refreshVersionRef = useRef(0)

  useEffect(() => {
    boardIdRef.current = boardId
    clearTimeout(saveTimerRef.current)
  }, [boardId])

  const refresh = useCallback(async () => {
    const targetBoardId = boardId
    const refreshVersion = refreshVersionRef.current + 1
    refreshVersionRef.current = refreshVersion
    if (!targetBoardId) {
      if (refreshVersion === refreshVersionRef.current) {
        setEdges([])
        setLoading(false)
      }
      return
    }
    setLoading(true)
    try {
      const result: BrowserEdge[] = await window.api.browserEdges.list(targetBoardId)
      if (refreshVersion !== refreshVersionRef.current) return
      if (boardIdRef.current !== targetBoardId) return
      setEdges(
        result.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle
        }))
      )
    } finally {
      if (refreshVersion === refreshVersionRef.current && boardIdRef.current === targetBoardId) {
        setLoading(false)
      }
    }
  }, [boardId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const saveEdges = useCallback(async (newEdges: Edge[]) => {
    const targetBoardId = boardId
    setEdges(newEdges)
    if (!targetBoardId) return
    // Debounced save — 500ms
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (boardIdRef.current !== targetBoardId) return
      try {
        await window.api.browserEdges.save(
          newEdges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined
          })),
          targetBoardId
        )
      } catch (error) {
        console.error('[browser-edges] failed to persist edges:', error)
      }
    }, 500)
  }, [boardId])

  useEffect(() => {
    return (): void => {
      clearTimeout(saveTimerRef.current)
    }
  }, [])

  return { edges, loading, refresh, saveEdges }
}
