import { useState, useEffect, useCallback, useMemo } from 'react'

export interface WorkspaceFolder {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceBoard {
  id: string
  folderId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceState {
  rootDir: string
  activeBoardId: string | null
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  plans: WorkspacePlan[]
}

export interface WorkspacePlan {
  id: string
  folderId: string | null
  name: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export function useWorkspace(): {
  workspace: WorkspaceState | null
  loading: boolean
  activeBoard: WorkspaceBoard | null
  refresh: () => Promise<void>
  setRootDir: (rootDir: string) => Promise<void>
  createFolder: (name?: string) => Promise<void>
  renameFolder: (folderId: string, name: string) => Promise<void>
  deleteFolder: (folderId: string) => Promise<void>
  createBoard: (payload?: { name?: string; folderId?: string | null }) => Promise<void>
  renameBoard: (boardId: string, name: string) => Promise<void>
  moveBoard: (boardId: string, folderId?: string | null) => Promise<void>
  deleteBoard: (boardId: string) => Promise<void>
  setActiveBoard: (boardId: string) => Promise<void>
  createPlan: (payload?: { name?: string; folderId?: string | null }) => Promise<void>
  renamePlan: (planId: string, name: string) => Promise<void>
  movePlan: (planId: string, folderId?: string | null) => Promise<void>
  deletePlan: (planId: string) => Promise<void>
  getPlanHtml: (planId: string) => Promise<string>
  setPlanHtml: (planId: string, html: string) => Promise<void>
} {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await window.api.workspace.getState()
      setWorkspace(snapshot)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const applyWorkspaceMutation = useCallback(
    async (mutate: () => Promise<WorkspaceState>) => {
      setLoading(true)
      try {
        const next = await mutate()
        setWorkspace(next)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const setRootDir = useCallback(
    async (rootDir: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.setRootDir(rootDir))
    },
    [applyWorkspaceMutation]
  )

  const createFolder = useCallback(
    async (name?: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.createFolder(name))
    },
    [applyWorkspaceMutation]
  )

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.renameFolder(folderId, name))
    },
    [applyWorkspaceMutation]
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.deleteFolder(folderId))
    },
    [applyWorkspaceMutation]
  )

  const createBoard = useCallback(
    async (payload?: { name?: string; folderId?: string | null }) => {
      await applyWorkspaceMutation(() => window.api.workspace.createBoard(payload))
    },
    [applyWorkspaceMutation]
  )

  const renameBoard = useCallback(
    async (boardId: string, name: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.renameBoard(boardId, name))
    },
    [applyWorkspaceMutation]
  )

  const moveBoard = useCallback(
    async (boardId: string, folderId?: string | null) => {
      await applyWorkspaceMutation(() => window.api.workspace.moveBoard(boardId, folderId))
    },
    [applyWorkspaceMutation]
  )

  const deleteBoard = useCallback(
    async (boardId: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.deleteBoard(boardId))
    },
    [applyWorkspaceMutation]
  )

  const setActiveBoard = useCallback(
    async (boardId: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.setActiveBoard(boardId))
    },
    [applyWorkspaceMutation]
  )

  const createPlan = useCallback(
    async (payload?: { name?: string; folderId?: string | null }) => {
      await applyWorkspaceMutation(() => window.api.workspace.createPlan(payload))
    },
    [applyWorkspaceMutation]
  )

  const renamePlan = useCallback(
    async (planId: string, name: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.renamePlan(planId, name))
    },
    [applyWorkspaceMutation]
  )

  const movePlan = useCallback(
    async (planId: string, folderId?: string | null) => {
      await applyWorkspaceMutation(() => window.api.workspace.movePlan(planId, folderId))
    },
    [applyWorkspaceMutation]
  )

  const deletePlan = useCallback(
    async (planId: string) => {
      await applyWorkspaceMutation(() => window.api.workspace.deletePlan(planId))
    },
    [applyWorkspaceMutation]
  )

  const getPlanHtml = useCallback(async (planId: string) => {
    return window.api.workspace.getPlanHtml(planId)
  }, [])

  const setPlanHtml = useCallback(async (planId: string, html: string) => {
    await window.api.workspace.setPlanHtml(planId, html)
  }, [])

  const activeBoard = useMemo(() => {
    if (!workspace?.activeBoardId) return null
    return workspace.boards.find((board) => board.id === workspace.activeBoardId) ?? null
  }, [workspace])

  return {
    workspace,
    loading,
    activeBoard,
    refresh,
    setRootDir,
    createFolder,
    renameFolder,
    deleteFolder,
    createBoard,
    renameBoard,
    moveBoard,
    deleteBoard,
    setActiveBoard,
    createPlan,
    renamePlan,
    movePlan,
    deletePlan,
    getPlanHtml,
    setPlanHtml
  }
}
