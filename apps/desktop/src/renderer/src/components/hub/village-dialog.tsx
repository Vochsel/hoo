import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useVillage } from './village-context'
import { BrowserTabDialog } from '@/components/browser/browser-tab-dialog'
import { TerminalDialog } from '@/components/browser/terminal-dialog'
import type { BrowserTab } from '@/hooks/use-browser-tabs'
import type { GraphNode } from '@/hooks/use-graph-nodes'

interface TerminalNodeConfig {
  command?: string
  cwd?: string
  shell?: string
  timeout?: number
  lastScrollback?: string
  lastScreenshot?: string
}

export function VillageDialog() {
  const { activeDialog, closeDialog } = useVillage()
  const [tab, setTab] = useState<BrowserTab | null>(null)
  const [terminalNode, setTerminalNode] = useState<GraphNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [workspaceRootDir, setWorkspaceRootDir] = useState<string | undefined>(undefined)
  const [boardRootDir, setBoardRootDir] = useState<string | null>(null)
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!activeDialog) {
      setTab(null)
      setTerminalNode(null)
      return
    }

    const itemId = activeDialog.id
    const realId = itemId.replace(/^desk-/, '').replace(/^interior-/, '')
    const boardId = activeDialog.boardId

    setLoading(true)

    window.api.workspace.getState().then((state: { rootDir: string }) => {
      setWorkspaceRootDir(state.rootDir)
    }).catch(() => {})
    window.api.workspace.getBoardRootDir(boardId).then((dir: unknown) => {
      setBoardRootDir((dir as string) || null)
    }).catch(() => {})

    Promise.all([
      window.api.browserTabs.list(boardId) as Promise<BrowserTab[]>,
      window.api.graphNodes.list(boardId) as Promise<GraphNode[]>
    ]).then(([tabs, nodes]) => {
      const foundTab = tabs.find((t) => t.id === realId)
      if (foundTab) {
        setTab(foundTab)
        setTerminalNode(null)
        setLoading(false)
        return
      }

      const foundNode = nodes.find((n) => n.id === realId && n.nodeType === 'terminal')
      if (foundNode) {
        setTerminalNode(foundNode)
        setTab(null)
        setLoading(false)
        return
      }

      // Agent: show first tab
      if (itemId.includes('agent') && tabs.length > 0) {
        setTab(tabs[0])
        setLoading(false)
        return
      }

      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [activeDialog])

  const handleClose = useCallback(() => {
    closeDialog()
    // Re-acquire pointer lock for FPS after a short delay
    setTimeout(() => {
      const canvas = document.querySelector('canvas')
      if (canvas) try { canvas.requestPointerLock() } catch { /* ignore */ }
    }, 100)
  }, [closeDialog])

  if (!activeDialog) return null

  const backButton = (
    <button
      type="button"
      className="fixed top-2 right-3 z-[60] flex items-center gap-1.5 rounded-lg bg-background/90 border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur-sm hover:bg-accent hover:text-foreground transition-colors"
      onClick={handleClose}
    >
      <X className="h-3.5 w-3.5" />
      Back to Village
    </button>
  )

  // Browser tab — use the same BrowserTabDialog from whiteboard view
  if (tab) {
    return (
      <>
        <BrowserTabDialog
          tab={tab}
          boardId={activeDialog.boardId}
          open={true}
          onOpenChange={async (open) => {
            if (!open) {
              // Small delay to ensure screenshot persist completes before re-fetch
              await new Promise((r) => setTimeout(r, 200))
              handleClose()
            }
          }}
          onTabUpdate={async (id, data) => {
            const result = await window.api.browserTabs.update(id, data, activeDialog.boardId)
            setTab((prev) => prev ? { ...prev, ...data } as BrowserTab : prev)
            return result
          }}
        />
        {backButton}
      </>
    )
  }

  // Terminal — use TerminalDialog with portal contained inside our layout
  if (terminalNode) {
    const config: TerminalNodeConfig = terminalNode.config ? JSON.parse(terminalNode.config) : {}
    const latestConfigRef = { current: config }
    return (
      <>
        <style>{`
          .village-terminal-portal [data-radix-popper-content-wrapper],
          .village-terminal-portal > div { position: fixed !important; inset: 0 !important; }
          .village-terminal-portal [role="dialog"] {
            position: absolute !important;
            inset: 16px !important;
            left: 16px !important;
            top: 16px !important;
            transform: none !important;
            width: auto !important;
            max-width: none !important;
            height: auto !important;
            max-height: none !important;
          }
        `}</style>
        <div ref={setPortalContainer} className="village-terminal-portal fixed inset-0 z-50" />
        {portalContainer && (
          <TerminalDialog
            open={true}
            onOpenChange={async (open) => {
              if (!open) {
                // Persist the latest config (including screenshot) before unmounting
                await window.api.graphNodes.update(terminalNode.id, { config: JSON.stringify(latestConfigRef.current) })
                handleClose()
              }
            }}
            sessionId={`pty-${terminalNode.id}`}
            label={terminalNode.label || 'Terminal'}
            config={config}
            onUpdateConfig={async (nextConfig) => {
              latestConfigRef.current = nextConfig as TerminalNodeConfig
              await window.api.graphNodes.update(terminalNode.id, { config: JSON.stringify(nextConfig) })
            }}
            workspaceRootDir={workspaceRootDir}
            boardRootDir={boardRootDir}
            portalContainer={portalContainer}
          />
        )}
        {backButton}
      </>
    )
  }

  // Loading or no match
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return null
}
