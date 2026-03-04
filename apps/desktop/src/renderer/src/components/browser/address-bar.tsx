import { useState, useCallback, useRef, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Loader2, Lock, Search, Pin, Home } from 'lucide-react'

interface AddressBarProps {
  url: string
  loading: boolean
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  pinnedUrl?: string | null
  onTogglePin?: () => void
  onGoHome?: () => void
}

function resolveInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z](\/|$)/.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname) + u.search
  } catch {
    return url
  }
}

function isSecure(url: string): boolean {
  return url.startsWith('https://')
}

export interface AddressBarHandle {
  focus: () => void
}

export const AddressBar = forwardRef<AddressBarHandle, AddressBarProps>(function AddressBar({
  url,
  loading,
  onNavigate,
  onBack,
  onForward,
  onReload,
  pinnedUrl,
  onTogglePin,
  onGoHome
}, ref): React.ReactElement {
  const [inputValue, setInputValue] = useState(url)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focus: (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }))

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const resolved = resolveInput(inputValue)
        if (resolved) onNavigate(resolved)
        ;(e.target as HTMLInputElement).blur()
      }
      if (e.key === 'Escape') {
        setInputValue(url)
        ;(e.target as HTMLInputElement).blur()
      }
    },
    [inputValue, onNavigate, url]
  )

  const handleFocus = (): void => {
    setInputValue(url)
    setFocused(true)
  }

  const handleBlur = (): void => {
    setFocused(false)
  }

  const secure = isSecure(url)

  return (
    <div className="flex items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
      <button
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="h-3 w-3" />
      </button>
      <button
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        onClick={onForward}
      >
        <ArrowRight className="h-3 w-3" />
      </button>
      <button
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        onClick={onReload}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCw className="h-3 w-3" />
        )}
      </button>
      <div className="relative ml-0.5 flex flex-1 items-center">
        <div className="pointer-events-none absolute left-2 z-10">
          {focused ? (
            <Search className="h-3 w-3 text-muted-foreground/50" />
          ) : secure ? (
            <Lock className="h-3 w-3 text-emerald-500/70" />
          ) : (
            <Search className="h-3 w-3 text-muted-foreground/50" />
          )}
        </div>
        <input
          ref={inputRef}
          value={focused ? inputValue : displayUrl(url)}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Search or enter URL..."
          className="h-6 w-full rounded-md bg-muted/60 pl-7 pr-2.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring/50 transition-all"
        />
      </div>
      {onTogglePin && (
        <button
          className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
            pinnedUrl ? 'text-primary' : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground'
          }`}
          onClick={onTogglePin}
          title={pinnedUrl ? 'Unpin URL' : 'Pin current URL'}
        >
          <Pin className="h-3 w-3" />
        </button>
      )}
      {pinnedUrl && onGoHome && (
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          onClick={onGoHome}
          title={`Go to pinned URL: ${pinnedUrl}`}
        >
          <Home className="h-3 w-3" />
        </button>
      )}
    </div>
  )
})
