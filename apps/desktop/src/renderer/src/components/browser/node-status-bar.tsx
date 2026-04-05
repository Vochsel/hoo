import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NodeStatusBarProps {
  status?: string
  isRunning?: boolean
  className?: string
  runtimeOutput?: string
}

export function NodeStatusBar({ status, isRunning, className, runtimeOutput }: NodeStatusBarProps): React.ReactElement | null {
  const message = status?.trim() || (isRunning ? 'Running...' : '')
  const [hovered, setHovered] = useState(false)
  if (!message) return null

  const hasOutput = !!runtimeOutput && !isRunning

  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 rounded border bg-muted/50 px-2 py-1',
        hasOutput && 'cursor-pointer',
        className
      )}
      title={hasOutput ? undefined : message}
      onMouseEnter={() => hasOutput && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isRunning ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
      )}
      <span className="truncate text-[10px] text-foreground/80">{message}</span>

      {hovered && hasOutput && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 w-[360px] max-h-[300px] overflow-auto rounded-md border bg-popover p-3 shadow-lg"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/90">
            {runtimeOutput!.length > 3000
              ? `${runtimeOutput!.slice(0, 3000)}\n\n[Truncated — ${runtimeOutput!.length} chars total]`
              : runtimeOutput}
          </pre>
        </div>
      )}
    </div>
  )
}

interface NodeExecutionFooterProps {
  status?: string
  isRunning?: boolean
  className?: string
  runtimeOutput?: string
  reserveSpace?: boolean
}

export function NodeExecutionFooter({
  status,
  isRunning,
  className,
  runtimeOutput,
  reserveSpace = false
}: NodeExecutionFooterProps): React.ReactElement | null {
  const message = status?.trim() || (isRunning ? 'Running...' : '')
  if (!message && !reserveSpace) return null

  return (
    <div className={cn('border-t px-3 py-1.5', !message && 'border-transparent', className)}>
      {message ? (
        <NodeStatusBar status={status} isRunning={isRunning} runtimeOutput={runtimeOutput} className="border-0 bg-muted/40 px-1.5 py-1" />
      ) : (
        <div aria-hidden="true" className="h-[22px]" />
      )}
    </div>
  )
}
