import { memo, useState, type ReactNode } from 'react'
import { type NodeProps, Position } from '@xyflow/react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HandleWithTooltip } from './handle-with-tooltip'
import { useFlowDirection, getTargetPosition } from './flow-direction-context'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { NodeExecutionFooter } from './node-status-bar'

export interface OutputNodeData {
  label: string
  config: { markdown?: string }
  isRunning?: boolean
  runtimeStatus?: string
  [key: string]: unknown
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][]; align: Array<'left' | 'center' | 'right' | null> }
  | { type: 'code'; code: string; language?: string }
  | { type: 'rule' }

const INLINE_TOKEN_REGEX = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g

function splitTableCells(row: string): string[] {
  let normalized = row.trim()
  if (normalized.startsWith('|')) normalized = normalized.slice(1)
  if (normalized.endsWith('|')) normalized = normalized.slice(0, -1)
  return normalized.split('|').map((cell) => cell.trim())
}

function isTableDelimiterRow(row: string): boolean {
  if (!row.includes('|')) return false
  const cells = splitTableCells(row)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function parseTableAlignment(cells: string[]): Array<'left' | 'center' | 'right' | null> {
  return cells.map((cell) => {
    const trimmed = cell.trim()
    if (!/^:?-{3,}:?$/.test(trimmed)) return null
    const starts = trimmed.startsWith(':')
    const ends = trimmed.endsWith(':')
    if (starts && ends) return 'center'
    if (ends) return 'right'
    if (starts) return 'left'
    return null
  })
}

function tableAlignClass(align: 'left' | 'center' | 'right' | null): string {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'
  return 'text-left'
}

function parseMarkdown(md: string): MarkdownBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []

  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let listItems: string[] = []
  let listOrdered = false
  let paragraphLines: string[] = []
  let quoteLines: string[] = []

  const flushCode = (): void => {
    if (!inCode) return
    blocks.push({ type: 'code', code: codeLines.join('\n'), language: codeLang || undefined })
    inCode = false
    codeLang = ''
    codeLines = []
  }

  const flushList = (): void => {
    if (listItems.length === 0) return
    blocks.push({ type: 'list', ordered: listOrdered, items: [...listItems] })
    listItems = []
    listOrdered = false
  }

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') })
    paragraphLines = []
  }

  const flushQuote = (): void => {
    if (quoteLines.length === 0) return
    blocks.push({ type: 'blockquote', text: quoteLines.join('\n') })
    quoteLines = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    const codeFence = trimmed.match(/^```(.*)$/)
    if (codeFence) {
      if (inCode) {
        flushCode()
      } else {
        flushQuote()
        flushParagraph()
        flushList()
        inCode = true
        codeLang = codeFence[1].trim()
        codeLines = []
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (!trimmed) {
      flushQuote()
      flushParagraph()
      flushList()
      continue
    }

    const hrMatch = trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/)
    if (hrMatch) {
      flushQuote()
      flushParagraph()
      flushList()
      blocks.push({ type: 'rule' })
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      flushQuote()
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] })
      continue
    }

    const nextLine = lines[i + 1]?.trim() ?? ''
    if (trimmed.includes('|') && isTableDelimiterRow(nextLine)) {
      flushQuote()
      flushParagraph()
      flushList()

      const headers = splitTableCells(trimmed)
      const align = parseTableAlignment(splitTableCells(nextLine))
      const rows: string[][] = []

      i += 2
      while (i < lines.length) {
        const candidate = lines[i].trim()
        if (!candidate || !candidate.includes('|')) break
        rows.push(splitTableCells(candidate))
        i += 1
      }
      i -= 1

      blocks.push({ type: 'table', headers, rows, align })
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph()
      flushList()
      quoteLines.push(quoteMatch[1])
      continue
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/)
    if (unorderedMatch) {
      flushQuote()
      flushParagraph()
      if (listItems.length > 0 && listOrdered) flushList()
      listOrdered = false
      listItems.push(unorderedMatch[1])
      continue
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (orderedMatch) {
      flushQuote()
      flushParagraph()
      if (listItems.length > 0 && !listOrdered) flushList()
      listOrdered = true
      listItems.push(orderedMatch[1])
      continue
    }

    flushQuote()
    flushList()
    paragraphLines.push(trimmed)
  }

  flushCode()
  flushQuote()
  flushParagraph()
  flushList()
  return blocks
}

function headingClass(level: number): string {
  if (level === 1) return 'text-base font-semibold text-foreground'
  if (level === 2) return 'text-sm font-semibold text-foreground'
  if (level === 3) return 'text-xs font-semibold text-foreground'
  return 'text-[11px] font-semibold text-foreground/90'
}

function renderInlineMarkdown(text: string): ReactNode[] {
  try {
    const nodes: ReactNode[] = []
    let lastIndex = 0
    let key = 0

    for (const match of text.matchAll(INLINE_TOKEN_REGEX)) {
      if (match.index === undefined) continue
      const token = match[0]

      if (match.index > lastIndex) {
        nodes.push(<span key={`plain-${key++}`}>{text.slice(lastIndex, match.index)}</span>)
      }

      if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
        nodes.push(<strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>)
      } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
        nodes.push(<em key={`em-${key++}`}>{token.slice(1, -1)}</em>)
      } else if (token.startsWith('`') && token.endsWith('`')) {
        nodes.push(
          <code key={`code-${key++}`} className="rounded bg-muted px-1 py-0.5 text-[10px] text-foreground">
            {token.slice(1, -1)}
          </code>
        )
      } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
        const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (linkMatch) {
          const [, label, href] = linkMatch
          nodes.push(
            <a
              key={`link-${key++}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-600 underline underline-offset-2 hover:text-emerald-700"
            >
              {label}
            </a>
          )
        } else {
          nodes.push(<span key={`token-${key++}`}>{token}</span>)
        }
      } else {
        nodes.push(<span key={`token-${key++}`}>{token}</span>)
      }

      lastIndex = match.index + token.length
    }

    if (lastIndex < text.length) {
      nodes.push(<span key={`plain-${key++}`}>{text.slice(lastIndex)}</span>)
    }

    return nodes.length > 0 ? nodes : [text]
  } catch (error) {
    console.error('[output-node] inline render failed:', error)
    return [text]
  }
}

function MarkdownReport({ markdown, compact = true }: { markdown: string; compact?: boolean }): React.ReactElement {
  let blocks: MarkdownBlock[] = []
  try {
    blocks = parseMarkdown(markdown)
  } catch (error) {
    console.error('[output-node] markdown parse failed:', error)
    return (
      <div className="">
        {/* <div className="mb-2 flex items-center justify-between border-b pb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground">Report</span>
          <span className="text-[9px] text-muted-foreground">{markdown.length.toLocaleString()} chars</span>
        </div> */}
        <pre className={cn(
          'overflow-auto text-left rounded bg-muted/70 p-2 text-[10px] leading-relaxed text-foreground whitespace-pre-wrap',
          compact ? 'max-h-[300px]' : 'max-h-[72vh]'
        )}>
          {markdown}
        </pre>
      </div>
    )
  }

  return (
    <div className="">
      {/* <div className="mb-2 flex items-center justify-between border-b pb-1.5">
        <span className="text-[10px] font-semibold text-muted-foreground">Report</span>
        <span className="text-[9px] text-muted-foreground">{markdown.length.toLocaleString()} chars</span>
      </div> */}
      <div
        className={cn(
          'nowheel nodrag nopan text-left overflow-y-auto overflow-x-hidden pr-1 space-y-2 select-text',
          compact ? 'max-h-[300px]' : 'max-h-[72vh]'
        )}
        onWheel={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {blocks.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground/70">No report content.</p>
        ) : (
          blocks.map((block, index) => {
            if (block.type === 'heading') {
              return (
                <h4 key={index} className={headingClass(block.level)}>
                  {renderInlineMarkdown(block.text)}
                </h4>
              )
            }
            if (block.type === 'paragraph') {
              return (
                <p key={index} className="text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                  {renderInlineMarkdown(block.text)}
                </p>
              )
            }
            if (block.type === 'blockquote') {
              return (
                <blockquote key={index} className="border-l-2 border-emerald-500/50 pl-2 text-[11px] text-foreground/80 italic whitespace-pre-wrap">
                  {renderInlineMarkdown(block.text)}
                </blockquote>
              )
            }
            if (block.type === 'list') {
              if (block.ordered) {
                return (
                  <ol key={index} className="list-decimal pl-4 space-y-1 text-[11px] text-foreground/90">
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
                    ))}
                  </ol>
                )
              }
              return (
                <ul key={index} className="list-disc pl-4 space-y-1 text-[11px] text-foreground/90">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
                  ))}
                </ul>
              )
            }
            if (block.type === 'table') {
              return (
                <div key={index} className="nowheel overflow-x-auto rounded border bg-background/60">
                  <table className="w-full border-collapse text-[10px] text-foreground/90">
                    <thead>
                      <tr className="bg-muted/50">
                        {block.headers.map((header, headerIndex) => (
                          <th
                            key={headerIndex}
                            className={cn(
                              'border-b border-border px-2 py-1 font-semibold',
                              tableAlignClass(block.align[headerIndex] ?? null)
                            )}
                          >
                            {renderInlineMarkdown(header)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
                          {block.headers.map((_, colIndex) => (
                            <td
                              key={colIndex}
                              className={cn(
                                'border-t border-border px-2 py-1 align-top',
                                tableAlignClass(block.align[colIndex] ?? null)
                              )}
                            >
                              {renderInlineMarkdown(row[colIndex] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            if (block.type === 'code') {
              return (
                <div key={index} className="space-y-1">
                  {block.language && (
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{block.language}</p>
                  )}
                  <pre className="nowheel overflow-auto rounded bg-muted/70 p-2 text-[10px] leading-relaxed text-foreground">
                    <code>{block.code}</code>
                  </pre>
                </div>
              )
            }
            return <div key={index} className="h-px bg-border" />
          })
        )}
      </div>
    </div>
  )
}

function OutputNodeInner({ data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus } = data as unknown as OutputNodeData
  const markdown = config?.markdown || ''
  const [open, setOpen] = useState(false)
  const targetPos = getTargetPosition(useFlowDirection())

  return (
    <>
      <div
        className={cn(
          'w-[360px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
          selected && 'ring-2 ring-primary'
        )}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (markdown) setOpen(true)
        }}
      >
        <HandleWithTooltip
          label="Input"
          type="target"
          position={targetPos}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />

        <div className="mb-2 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-emerald-500" />
          <span className="text-xs font-medium truncate">{label || 'Output'}</span>
        </div>

        {markdown ? (
          <MarkdownReport markdown={markdown} />
        ) : (
          <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground/70">
            Connect this node to a browser or prompt node to capture markdown output.
          </div>
        )}

        <NodeExecutionFooter
          status={runtimeStatus}
          isRunning={isRunning}
          className="-mb-3 -mx-3 mt-2 px-3 py-1.5"
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[95vw] max-w-[1100px]"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{label || 'Output'} · {markdown.length.toLocaleString()} chars</DialogTitle>
          </DialogHeader>
          <MarkdownReport markdown={markdown} compact={false} />
        </DialogContent>
      </Dialog>
    </>
  )
}

export const OutputNode = memo(OutputNodeInner)
