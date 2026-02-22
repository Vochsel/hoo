import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NodeStatusBarProps {
  status?: string
  isRunning?: boolean
  className?: string
}

export function NodeStatusBar({ status, isRunning, className }: NodeStatusBarProps): React.ReactElement | null {
  const message = status?.trim() || (isRunning ? 'Running...' : '')
  if (!message) return null

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded border bg-muted/50 px-2 py-1',
        className
      )}
      title={message}
    >
      {isRunning ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
      )}
      <span className="truncate text-[10px] text-foreground/80">{message}</span>
    </div>
  )
}
