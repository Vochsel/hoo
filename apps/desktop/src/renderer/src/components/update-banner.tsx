import { useEffect, useState } from 'react'
import { Download, RotateCcw } from 'lucide-react'

type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready' }

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    const unsub1 = window.api.updater.onUpdateAvailable((info) => {
      setState({ status: 'available', version: info.version })
    })
    const unsub2 = window.api.updater.onDownloadProgress((progress) => {
      setState({ status: 'downloading', percent: progress.percent })
    })
    const unsub3 = window.api.updater.onUpdateDownloaded(() => {
      setState({ status: 'ready' })
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  if (state.status === 'idle') return null

  return (
    <div className="px-2 py-1.5">
      {state.status === 'available' && (
        <button
          type="button"
          onClick={() => window.api.updater.download()}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-blue-400 hover:bg-accent hover:text-blue-300 transition-colors"
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">v{state.version} available</span>
        </button>
      )}
      {state.status === 'downloading' && (
        <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground">
          <Download className="h-3.5 w-3.5 shrink-0 animate-pulse" />
          <span className="truncate">Downloading… {Math.round(state.percent)}%</span>
        </div>
      )}
      {state.status === 'ready' && (
        <button
          type="button"
          onClick={() => window.api.updater.install()}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-blue-400 hover:bg-accent hover:text-blue-300 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Restart to update</span>
        </button>
      )}
    </div>
  )
}
