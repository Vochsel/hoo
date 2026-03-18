import { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkspaceFolder, WorkspaceBoard } from '@/hooks/use-workspace'

/* ------------------------------------------------------------------ */
/*  Custom node components                                            */
/* ------------------------------------------------------------------ */

function FolderNode({ data }: { data: { label: string } }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-border/60 bg-accent/30 px-4 py-2 backdrop-blur-sm">
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <p className="text-xs font-semibold text-muted-foreground">{data.label}</p>
    </div>
  )
}

function BoardNode({ data }: { data: { label: string } }) {
  return (
    <div className="cursor-pointer rounded-xl border border-border/50 bg-background/90 px-5 py-3 shadow-md backdrop-blur-sm transition-shadow hover:shadow-lg hover:border-foreground/30">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <p className="text-sm font-medium">{data.label}</p>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  folder: FolderNode as unknown as NodeTypes[string],
  board: BoardNode as unknown as NodeTypes[string]
}

/* ------------------------------------------------------------------ */
/*  Layout helpers                                                    */
/* ------------------------------------------------------------------ */

const FOLDER_GAP_X = 320
const BOARD_GAP_Y = 60
const BOARD_OFFSET_X = 40
const BOARD_OFFSET_Y = 50

function buildNodesAndEdges(
  folders: WorkspaceFolder[],
  boards: WorkspaceBoard[]
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const boardsByFolder = new Map<string | null, WorkspaceBoard[]>()
  for (const b of boards) {
    const key = b.folderId ?? null
    if (!boardsByFolder.has(key)) boardsByFolder.set(key, [])
    boardsByFolder.get(key)!.push(b)
  }

  // Sort folders by sortOrder
  const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder)

  // Add ungrouped boards as a virtual folder
  const ungrouped = boardsByFolder.get(null) ?? []

  let colIndex = 0

  // Ungrouped boards first
  if (ungrouped.length > 0) {
    const fx = colIndex * FOLDER_GAP_X
    nodes.push({
      id: '__ungrouped__',
      type: 'folder',
      position: { x: fx, y: 0 },
      data: { label: 'Ungrouped' },
      draggable: true
    })
    ungrouped.forEach((board, bi) => {
      const bid = `board-${board.id}`
      nodes.push({
        id: bid,
        type: 'board',
        position: { x: fx + BOARD_OFFSET_X, y: BOARD_OFFSET_Y + bi * BOARD_GAP_Y },
        data: { label: board.name, boardId: board.id }
      })
      edges.push({
        id: `e-ungrouped-${board.id}`,
        source: '__ungrouped__',
        target: bid,
        type: 'smoothstep',
        animated: true
      })
    })
    colIndex++
  }

  // Each folder
  for (const folder of sortedFolders) {
    const fx = colIndex * FOLDER_GAP_X
    const fid = `folder-${folder.id}`
    nodes.push({
      id: fid,
      type: 'folder',
      position: { x: fx, y: 0 },
      data: { label: folder.name }
    })

    const folderBoards = boardsByFolder.get(folder.id) ?? []
    folderBoards.sort((a, b) => a.sortOrder - b.sortOrder)
    folderBoards.forEach((board, bi) => {
      const bid = `board-${board.id}`
      nodes.push({
        id: bid,
        type: 'board',
        position: { x: fx + BOARD_OFFSET_X, y: BOARD_OFFSET_Y + bi * BOARD_GAP_Y },
        data: { label: board.name, boardId: board.id }
      })
      edges.push({
        id: `e-${folder.id}-${board.id}`,
        source: fid,
        target: bid,
        type: 'smoothstep',
        animated: true
      })
    })
    colIndex++
  }

  return { nodes, edges }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

interface HubReactFlowViewProps {
  folders: WorkspaceFolder[]
  boards: WorkspaceBoard[]
  onSelectBoard: (boardId: string) => void
}

function HubReactFlowViewInner({ folders, boards, onSelectBoard }: HubReactFlowViewProps) {
  const { nodes, edges } = useMemo(() => buildNodesAndEdges(folders, boards), [folders, boards])

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === 'board' && node.data.boardId) {
        onSelectBoard(node.data.boardId as string)
      }
    },
    [onSelectBoard]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.4 }}
      minZoom={0.2}
      maxZoom={2}
      panOnDrag={[0, 1]}
      panOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background />
    </ReactFlow>
  )
}

export function HubReactFlowView(props: HubReactFlowViewProps) {
  return (
    <ReactFlowProvider>
      <HubReactFlowViewInner {...props} />
    </ReactFlowProvider>
  )
}
