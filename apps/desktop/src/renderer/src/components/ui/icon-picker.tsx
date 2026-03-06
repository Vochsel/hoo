import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { icons, type LucideProps } from 'lucide-react'
import { Input } from '@/components/ui/input'

// ─── DynamicIcon ────────────────────────────────────────────────────────────

type DynamicIconProps = LucideProps & {
  name?: string
  fallback: React.ComponentType<LucideProps>
}

export function DynamicIcon({ name, fallback: Fallback, ...props }: DynamicIconProps): React.JSX.Element {
  if (name && name in icons) {
    const Icon = icons[name as keyof typeof icons]
    return <Icon {...props} />
  }
  return <Fallback {...props} />
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ICON_NAMES = Object.keys(icons)
const MAX_VISIBLE = 100

const COLOR_PRESETS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'yellow', value: '#eab308' },
  { name: 'green', value: '#22c55e' },
  { name: 'cyan', value: '#06b6d4' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'violet', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' }
]

// ─── IconPicker ─────────────────────────────────────────────────────────────

interface IconPickerProps {
  currentIcon?: string
  currentColor?: string
  onSelect: (meta: { icon?: string; color?: string }) => void
  onClose: () => void
  anchor: DOMRect
}

export function IconPicker({
  currentIcon,
  currentColor,
  onSelect,
  onClose,
  anchor
}: IconPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [selectedIcon, setSelectedIcon] = useState(currentIcon ?? '')
  const [selectedColor, setSelectedColor] = useState(currentColor ?? '')
  const popoverRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!search) return ICON_NAMES.slice(0, MAX_VISIBLE)
    const q = search.toLowerCase()
    const matches: string[] = []
    for (const name of ICON_NAMES) {
      if (name.toLowerCase().includes(q)) {
        matches.push(name)
        if (matches.length >= MAX_VISIBLE) break
      }
    }
    return matches
  }, [search])

  const handleIconClick = useCallback(
    (name: string) => {
      setSelectedIcon(name)
      onSelect({ icon: name, color: selectedColor || undefined })
    },
    [selectedColor, onSelect]
  )

  const handleColorClick = useCallback(
    (color: string) => {
      setSelectedColor(color)
      onSelect({ icon: selectedIcon || undefined, color })
    },
    [selectedIcon, onSelect]
  )

  const handleCustomColor = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const color = e.target.value
      setSelectedColor(color)
      onSelect({ icon: selectedIcon || undefined, color })
    },
    [selectedIcon, onSelect]
  )

  const handleReset = useCallback(() => {
    setSelectedIcon('')
    setSelectedColor('')
    onSelect({ icon: undefined, color: undefined })
  }, [onSelect])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Position: place below-right of anchor, but clamp to viewport
  const style = useMemo(() => {
    const top = anchor.bottom + 4
    const left = anchor.left
    return {
      position: 'fixed' as const,
      top: Math.min(top, window.innerHeight - 370),
      left: Math.min(left, window.innerWidth - 280),
      zIndex: 9999
    }
  }, [anchor])

  return (
    <div
      ref={popoverRef}
      style={style}
      className="w-[268px] rounded-lg border bg-popover p-3 shadow-lg"
    >
      {/* Search */}
      <Input
        placeholder="Search icons…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-2 h-7 text-xs"
        autoFocus
      />

      {/* Icon grid */}
      <div className="mb-2 grid max-h-[180px] grid-cols-6 gap-1 overflow-y-auto">
        {filtered.map((name) => {
          const Icon = icons[name as keyof typeof icons]
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => handleIconClick(name)}
              className={[
                'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
                name === selectedIcon
                  ? 'bg-accent ring-1 ring-ring'
                  : 'hover:bg-accent/60'
              ].join(' ')}
            >
              <Icon className="h-4 w-4" style={selectedColor ? { color: selectedColor } : undefined} />
            </button>
          )
        })}
        {filtered.length === 0 && (
          <p className="col-span-6 py-4 text-center text-xs text-muted-foreground">
            No icons found
          </p>
        )}
      </div>

      {/* Color swatches */}
      <div className="mb-2 flex items-center gap-1.5">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c.name}
            type="button"
            title={c.name}
            onClick={() => handleColorClick(c.value)}
            className={[
              'h-5 w-5 rounded-full border transition-transform',
              selectedColor === c.value ? 'scale-125 ring-1 ring-ring' : 'hover:scale-110'
            ].join(' ')}
            style={{ backgroundColor: c.value }}
          />
        ))}
        {/* Custom color */}
        <label className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border hover:scale-110 transition-transform" title="Custom color">
          <input
            type="color"
            value={selectedColor || '#888888'}
            onChange={handleCustomColor}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span className="text-[9px] font-bold text-muted-foreground">#</span>
        </label>
      </div>

      {/* Reset */}
      <button
        type="button"
        onClick={handleReset}
        className="w-full rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        Reset to default
      </button>
    </div>
  )
}
