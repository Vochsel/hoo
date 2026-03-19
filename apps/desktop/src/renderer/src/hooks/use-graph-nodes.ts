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

function orderNodesByIds(graphNodes: GraphNode[], orderedIds: string[]): GraphNode[] {
  if (orderedIds.length === 0) return graphNodes
  const nodesById = new Map(graphNodes.map((node) => [node.id, node]))
  const orderedNodes = orderedIds
    .map((id) => nodesById.get(id))
    .filter((node): node is GraphNode => node != null)
  const orderedIdSet = new Set(orderedNodes.map((node) => node.id))
  return [...orderedNodes, ...graphNodes.filter((node) => !orderedIdSet.has(node.id))]
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
  saveOrder: (orderedIds: string[]) => Promise<void>
  savePositions: (positions: Array<{ id: string; x: number; y: number }>) => Promise<void>
} {
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(boardId)
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
        setLoadedBoardId(null)
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
      setLoadedBoardId(targetBoardId)
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
        setLoadedBoardId(targetBoardId)
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
          setLoadedBoardId(targetBoardId)
          setGraphNodes(latest)
        }
        const fallback = latest.find((entry) => entry.id === id)
        if (!fallback) {
          throw new Error(`Graph node not found: ${id}`)
        }
        return fallback
      }
      if (boardIdRef.current === targetBoardId) {
        setLoadedBoardId(targetBoardId)
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
        setLoadedBoardId(targetBoardId)
        setGraphNodes((prev) => prev.filter((node) => node.id !== id))
      }
    },
    [boardId]
  )

  const saveOrder = useCallback(
    async (orderedIds: string[]) => {
      const targetBoardId = boardId
      if (!targetBoardId) return
      if (boardIdRef.current === targetBoardId) {
        setLoadedBoardId(targetBoardId)
        setGraphNodes((prev) => orderNodesByIds(prev, orderedIds))
      }
      await window.api.graphNodes.saveOrder(orderedIds, targetBoardId)
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
      setLoadedBoardId(targetBoardId)
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

  const visibleGraphNodes = loadedBoardId === boardId ? graphNodes : []
  const visibleLoading = loading || loadedBoardId !== boardId

  return {
    graphNodes: visibleGraphNodes,
    loading: visibleLoading,
    refresh,
    createNode,
    updateNode,
    deleteNode,
    saveOrder,
    savePositions
  }
}
