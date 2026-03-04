import { useEffect, useState } from 'react'

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
    <div className="flex items-center gap-3 px-4 py-2 text-xs bg-blue-600 text-white">
      {state.status === 'available' && (
        <>
          <span>Version {state.version} is available.</span>
          <button
            onClick={() => window.api.updater.download()}
            className="underline font-medium hover:opacity-80"
          >
            Download
          </button>
        </>
      )}
      {state.status === 'downloading' && (
        <span>Downloading update… {Math.round(state.percent)}%</span>
      )}
      {state.status === 'ready' && (
        <>
          <span>Update ready.</span>
          <button
            onClick={() => window.api.updater.install()}
            className="underline font-medium hover:opacity-80"
          >
            Restart now
          </button>
        </>
      )}
    </div>
  )
}
