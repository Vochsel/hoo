import { useState, useEffect, useCallback } from 'react'

export interface GraphNode {
  id: string
  nodeType: 'trigger' | 'scheduleTrigger' | 'debug' | 'notification' | 'aiPrompt' | 'delay' | 'text' | 'output' | 'file'
  label: string
  config: string
  flowX: number
  flowY: number
  createdAt: string
  updatedAt: string
}

export function useGraphNodes(): {
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

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await window.api.graphNodes.list()
    setGraphNodes(result)
    setLoading(false)
  }, [])

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
      const node = await window.api.graphNodes.create(data)
      await refresh()
      return node
    },
    [refresh]
  )

  const updateNode = useCallback(
    async (id: string, data: Record<string, unknown>) => {
      const node = await window.api.graphNodes.update(id, data)
      await refresh()
      return node
    },
    [refresh]
  )

  const deleteNode = useCallback(
    async (id: string) => {
      await window.api.graphNodes.delete(id)
      await refresh()
    },
    [refresh]
  )

  const savePositions = useCallback(
    async (positions: Array<{ id: string; x: number; y: number }>) => {
      await window.api.graphNodes.savePositions(positions)
    },
    []
  )

  return { graphNodes, loading, refresh, createNode, updateNode, deleteNode, savePositions }
}
