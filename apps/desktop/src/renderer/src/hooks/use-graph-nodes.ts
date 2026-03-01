import { useState, useEffect, useCallback, useRef } from 'react'

export interface GraphNode {
  id: string
  nodeType: 'trigger' | 'scheduleTrigger' | 'formTrigger' | 'debug' | 'notification' | 'aiPrompt' | 'delay' | 'text' | 'output' | 'file' | 'terminal'
  label: string
  config: string
  flowX: number
  flowY: number
  createdAt: string
  updatedAt: string
}

export function useGraphNodes(boardId: string | null): {
  graphNodes: GraphNode[]
  loading: boolean
  refresh: () => Promise<void>
  createNode: (data: {
    nodeType: string
    label?: string
    config?: string
    flowX?: number
    flowY?: number
  }) => Promise<GraphNode>
  updateNode: (id: string, data: Record<string, unknown>) => Promise<GraphNode>
  deleteNode: (id: string) => Promise<void>
  savePositions: (positions: Array<{ id: string; x: number; y: number }>) => Promise<void>
} {
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([])
  const [loading, setLoading] = useState(true)
  const boardIdRef = useRef<string | null>(boardId)
  const refreshVersionRef = useRef(0)

  useEffect(() => {
    boardIdRef.current = boardId
  }, [boardId])

  const refresh = useCallback(async () => {
    const targetBoardId = boardId
    const refreshVersion = refreshVersionRef.current + 1
    refreshVersionRef.current = refreshVersion
    if (!targetBoardId) {
      if (refreshVersion === refreshVersionRef.current) {
        setGraphNodes([])
        setLoading(false)
      }
      return
    }

    setLoading(true)
    try {
      const result = await window.api.graphNodes.list(targetBoardId)
      if (refreshVersion !== refreshVersionRef.current) return
      if (boardIdRef.current !== targetBoardId) return
      setGraphNodes(result)
    } finally {
      if (refreshVersion === refreshVersionRef.current && boardIdRef.current === targetBoardId) {
        setLoading(false)
      }
    }
  }, [boardId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createNode = useCallback(
    async (data: {
      nodeType: string
      label?: string
      config?: string
      flowX?: number
      flowY?: number
    }) => {
      const targetBoardId = boardId
      if (!targetBoardId) {
        throw new Error('No board selected')
      }
      const node = await window.api.graphNodes.create(data, targetBoardId)
      if (boardIdRef.current === targetBoardId) {
        setGraphNodes((prev) => [...prev, node])
      }
      return node
    },
    [boardId]
  )

  const updateNode = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      const targetBoardId = boardId
      if (!targetBoardId) {
        throw new Error('No board selected')
      }
      const node = await window.api.graphNodes.update(id, data, targetBoardId)
      if (!node) {
        const latest = await window.api.graphNodes.list(targetBoardId)
        if (boardIdRef.current === targetBoardId) {
          setGraphNodes(latest)
        }
        const fallback = latest.find((entry) => entry.id === id)
        if (!fallback) {
          throw new Error(`Graph node not found: ${id}`)
        }
        return fallback
      }
      if (boardIdRef.current === targetBoardId) {
        setGraphNodes((prev) => prev.map((entry) => (entry.id === id ? node : entry)))
      }
      return node
    },
    [boardId]
  )

  const deleteNode = useCallback(
    async (id: string) => {
      const targetBoardId = boardId
      if (!targetBoardId) return
      await window.api.graphNodes.delete(id, targetBoardId)
      if (boardIdRef.current === targetBoardId) {
        setGraphNodes((prev) => prev.filter((node) => node.id !== id))
      }
    },
    [boardId]
  )

  const savePositions = useCallback(
    async (positions: Array<{ id: string; x: number; y: number }>) => {
      const targetBoardId = boardId
      if (!targetBoardId) return
      await window.api.graphNodes.savePositions(positions, targetBoardId)
      if (boardIdRef.current !== targetBoardId || positions.length === 0) return
      const positionsById = new Map(positions.map((entry) => [entry.id, entry]))
      const updatedAt = new Date().toISOString()
      setGraphNodes((prev) =>
        prev.map((node) => {
          const nextPosition = positionsById.get(node.id)
          if (!nextPosition) return node
          return {
            ...node,
            flowX: nextPosition.x,
            flowY: nextPosition.y,
            updatedAt
          }
        })
      )
    },
    [boardId]
  )

  return { graphNodes, loading, refresh, createNode, updateNode, deleteNode, savePositions }
}
