import { type ComponentProps } from 'react'
import { Handle } from '@xyflow/react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'

type HandleProps = ComponentProps<typeof Handle>

interface HandleWithTooltipProps extends HandleProps {
  label: string
}

export function HandleWithTooltip({ label, className, ...handleProps }: HandleWithTooltipProps): React.ReactElement {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Handle
            {...handleProps}
            className={`${className ?? ''} pointer-events-none opacity-0 before:!absolute before:!-inset-2 before:!rounded-full before:!content-['']`}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[10px] px-2 py-1">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
