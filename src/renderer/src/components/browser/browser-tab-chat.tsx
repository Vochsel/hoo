import { useState, useRef, useEffect, type KeyboardEvent, type ReactNode } from 'react'
import { Send, Square, Eye, EyeOff, Trash2, MousePointerClick, Keyboard, Navigation, ArrowUpDown, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DialogClose } from '@/components/ui/dialog'
import { useBrowserTabChat, type BrowserAction, type ActionResult, type PageContext } from '@/hooks/use-browser-tabs'
import { cn } from '@/lib/utils'

const TAG = '[browser-chat]'
const MAX_AGENT_LOOPS = 10
const INLINE_TOKEN_REGEX = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g

interface BrowserTabChatProps {
  tabId: string
  gatherPageContext: (includeScreenshot: boolean) => Promise<PageContext>
  executeBrowserActions: (actions: BrowserAction[]) => Promise<ActionResult[]>
  waitForPageSettle: () => Promise<void>
}

interface ActionEntry {
  id: string
  results: ActionResult[]
  timestamp: number
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][]; align: Array<'left' | 'center' | 'right' | null> }
  | { type: 'code'; code: string; language?: string }
  | { type: 'rule' }

const ACTION_ICONS: Record<string, typeof MousePointerClick> = {
  click: MousePointerClick,
  fill: Keyboard,
  navigate: Navigation,
  scroll: ArrowUpDown
}

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

function renderInlineMarkdown(text: string, isUser: boolean): ReactNode[] {
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
        <code
          key={`code-${key++}`}
          className={cn(
            'rounded px-1 py-0.5 text-[10px]',
            isUser ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-muted text-foreground'
          )}
        >
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
            className={cn(
              'underline underline-offset-2',
              isUser ? 'text-primary-foreground/95 hover:text-primary-foreground' : 'text-emerald-600 hover:text-emerald-700'
            )}
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
}

function headingClass(level: number): string {
  if (level === 1) return 'text-[13px] font-semibold'
  if (level === 2) return 'text-[12px] font-semibold'
  return 'text-[11px] font-semibold'
}

function MarkdownMessage({ markdown, isUser }: { markdown: string; isUser: boolean }): React.ReactElement {
  let blocks: MarkdownBlock[] = []
  try {
    blocks = parseMarkdown(markdown)
  } catch {
    return <p className="whitespace-pre-wrap break-words">{markdown}</p>
  }

  if (blocks.length === 0) {
    return <p className="whitespace-pre-wrap break-words">{markdown}</p>
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 key={index} className={headingClass(block.level)}>
              {renderInlineMarkdown(block.text, isUser)}
            </h4>
          )
        }
        if (block.type === 'paragraph') {
          return (
            <p key={index} className="whitespace-pre-wrap break-words">
              {renderInlineMarkdown(block.text, isUser)}
            </p>
          )
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={index}
              className={cn(
                'border-l-2 pl-2 italic whitespace-pre-wrap break-words',
                isUser ? 'border-primary-foreground/40' : 'border-emerald-500/50'
              )}
            >
              {renderInlineMarkdown(block.text, isUser)}
            </blockquote>
          )
        }
        if (block.type === 'list') {
          const listClass = 'space-y-0.5 pl-4'
          if (block.ordered) {
            return (
              <ol key={index} className={cn('list-decimal', listClass)}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlineMarkdown(item, isUser)}</li>
                ))}
              </ol>
            )
          }
          return (
            <ul key={index} className={cn('list-disc', listClass)}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item, isUser)}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'table') {
          return (
            <div
              key={index}
              className={cn(
                'overflow-x-auto rounded border',
                isUser ? 'border-primary-foreground/20 bg-primary-foreground/5' : 'border-border bg-background/60'
              )}
            >
              <table className={cn('w-full border-collapse text-[10px]', isUser ? 'text-primary-foreground' : 'text-foreground/90')}>
                <thead>
                  <tr className={isUser ? 'bg-primary-foreground/10' : 'bg-muted/50'}>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={headerIndex}
                        className={cn(
                          'border-b px-2 py-1 font-semibold',
                          isUser ? 'border-primary-foreground/20' : 'border-border',
                          tableAlignClass(block.align[headerIndex] ?? null)
                        )}
                      >
                        {renderInlineMarkdown(header, isUser)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className={isUser ? 'odd:bg-primary-foreground/5 even:bg-primary-foreground/10' : 'odd:bg-background even:bg-muted/20'}>
                      {block.headers.map((_, colIndex) => (
                        <td
                          key={colIndex}
                          className={cn(
                            'border-t px-2 py-1 align-top',
                            isUser ? 'border-primary-foreground/20' : 'border-border',
                            tableAlignClass(block.align[colIndex] ?? null)
                          )}
                        >
                          {renderInlineMarkdown(row[colIndex] ?? '', isUser)}
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
                <p className={cn('text-[9px] uppercase tracking-wider', isUser ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                  {block.language}
                </p>
              )}
              <pre
                className={cn(
                  'overflow-auto rounded p-2 text-[10px] leading-relaxed',
                  isUser ? 'bg-primary-foreground/10 text-primary-foreground' : 'bg-muted/70 text-foreground'
                )}
              >
                <code>{block.code}</code>
              </pre>
            </div>
          )
        }
        return <div key={index} className={cn('h-px', isUser ? 'bg-primary-foreground/20' : 'bg-border')} />
      })}
    </div>
  )
}

export function BrowserTabChat({
  tabId,
  gatherPageContext,
  executeBrowserActions,
  waitForPageSettle
}: BrowserTabChatProps): React.ReactElement {
  const { messages, sending, sendMessage, clearMessages } = useBrowserTabChat(tabId)
  const [input, setInput] = useState('')
  const [screenshotEnabled, setScreenshotEnabled] = useState(true)
  const [actionEntries, setActionEntries] = useState<ActionEntry[]>([])
  const [loopStep, setLoopStep] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortedRef = useRef(false)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, actionEntries, loopStep])

  useEffect(() => {
    setActionEntries([])
  }, [tabId])

  const handleSend = async (): Promise<void> => {
    const msg = input.trim()
    if (!msg || sending) return
    setInput('')

    abortedRef.current = false
    console.log(`${TAG} Sending message: "${msg}" (vision=${screenshotEnabled})`)

    const pageContext = await gatherPageContext(screenshotEnabled)
    let actions = await sendMessage(msg, pageContext)
    console.log(`${TAG} AI returned ${actions.length} action(s)`)

    let iteration = 0
    let prevActionKey = ''
    let repeatCount = 0
    while (actions.length > 0 && iteration < MAX_AGENT_LOOPS) {
      if (abortedRef.current) {
        console.log(`${TAG} Agent loop aborted by user`)
        break
      }
      iteration++
      setLoopStep(iteration)
      console.log(`${TAG} === Agent loop iteration ${iteration}/${MAX_AGENT_LOOPS} ===`)

      // Detect repeated identical actions to break infinite loops
      const actionKey = actions.map((a) => `${a.type}:${a.index ?? ''}:${a.url ?? ''}:${a.value ?? ''}`).join('|')
      if (actionKey === prevActionKey) {
        repeatCount++
        if (repeatCount >= 2) {
          console.warn(`${TAG} Breaking loop — same action repeated ${repeatCount + 1} times`)
          break
        }
      } else {
        repeatCount = 0
      }
      prevActionKey = actionKey

      console.log(`${TAG} Executing ${actions.length} actions on webview...`)
      const results = await executeBrowserActions(actions)
      console.log(`${TAG} Actions execution complete — ${results.length} result(s)`)

      if (results.length > 0) {
        setActionEntries((prev) => [
          ...prev,
          { id: `action-${Date.now()}`, results, timestamp: Date.now() }
        ])
      }

      console.log(`${TAG} Waiting for page to settle...`)
      await waitForPageSettle()

      console.log(`${TAG} Gathering updated page context...`)
      const updatedContext = await gatherPageContext(screenshotEnabled)

      const resultSummary = results
        .map((r) => `${r.type}: ${r.success ? 'OK' : 'FAILED'} — ${r.description}`)
        .join('\n')

      const continuationMsg = `[Actions executed — iteration ${iteration}]\n${resultSummary}\n\nThe page has updated. Look at the current page state and continue with the original task if more steps are needed. If the task is complete, just confirm what was done.`

      console.log(`${TAG} Sending continuation to AI...`)
      actions = await sendMessage(continuationMsg, updatedContext)
      console.log(`${TAG} AI returned ${actions.length} action(s) on iteration ${iteration}`)
    }

    if (iteration >= MAX_AGENT_LOOPS && actions.length > 0) {
      console.warn(`${TAG} Agent loop hit max iterations (${MAX_AGENT_LOOPS})`)
    }

    setLoopStep(0)
    console.log(`${TAG} Agent loop complete after ${iteration} iteration(s)`)
  }

  const handleStop = async (): Promise<void> => {
    console.log(`${TAG} Stop button clicked`)
    abortedRef.current = true
    await window.api.browserTabs.abortChat(tabId)
  }

  const handleClear = async (): Promise<void> => {
    await clearMessages()
    setActionEntries([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const lastMsgTime = (msgIndex: number): number => {
    if (msgIndex < 0 || msgIndex >= messages.length) return 0
    return new Date(messages[msgIndex].createdAt).getTime()
  }

  const isInternalMsg = (content: string): boolean => content.startsWith('[Actions executed')

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5 pl-1">
          <Sparkles className="h-3 w-3 text-primary/70" />
          <span className="text-[11px] font-medium text-foreground/80">AI</span>
        </div>
        <div className="flex items-center">
          <button
            onClick={() => setScreenshotEnabled((v) => !v)}
            title={screenshotEnabled ? 'Vision enabled' : 'Vision disabled'}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              screenshotEnabled
                ? 'text-primary/80 hover:bg-primary/10'
                : 'text-muted-foreground/40 hover:bg-muted'
            )}
          >
            {screenshotEnabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              title="Clear chat"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <DialogClose className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </DialogClose>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="space-y-2.5 p-3">
          {messages.length === 0 && actionEntries.length === 0 && !sending && (
            <div className="flex flex-col items-center gap-2 py-10">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/5">
                <Sparkles className="h-4 w-4 text-primary/40" />
              </div>
              <p className="text-center text-[11px] text-muted-foreground/60 max-w-[200px] leading-relaxed">
                Ask the AI to interact with this page
              </p>
            </div>
          )}
          {messages.map((msg, msgIdx) => {
            if (msg.role === 'user' && isInternalMsg(msg.content)) return null

            const msgTime = new Date(msg.createdAt).getTime()
            const nextMsgTime = lastMsgTime(msgIdx + 1) || Infinity
            const actionsAfter = actionEntries.filter(
              (ae) => ae.timestamp >= msgTime && ae.timestamp < nextMsgTime
            )

            return (
              <div key={msg.id} className="space-y-1.5">
                <div
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed',
                    msg.role === 'user'
                      ? 'ml-8 bg-primary text-primary-foreground'
                      : 'mr-4 bg-muted/60 text-foreground/90'
                  )}
                >
                  <MarkdownMessage markdown={msg.content} isUser={msg.role === 'user'} />
                </div>

                {actionsAfter.map((ae) => (
                  <div key={ae.id} className="space-y-0.5 pl-1">
                    {ae.results.map((r, ri) => {
                      const Icon = ACTION_ICONS[r.type] ?? MousePointerClick
                      return (
                        <div
                          key={ri}
                          className={cn(
                            'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                            r.success
                              ? 'text-emerald-600/80 dark:text-emerald-400/80'
                              : 'text-red-500/80 dark:text-red-400/80'
                          )}
                        >
                          <Icon className="h-2.5 w-2.5 shrink-0" />
                          <span className="font-medium capitalize">{r.type}</span>
                          <span className="truncate opacity-60">{r.description}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}

          {/* Trailing action entries */}
          {(() => {
            const lastTime = messages.length > 0
              ? new Date(messages[messages.length - 1].createdAt).getTime()
              : 0
            const trailing = actionEntries.filter((ae) => ae.timestamp >= lastTime && !messages.some((m, mi) => {
              const mTime = new Date(m.createdAt).getTime()
              const nextTime = lastMsgTime(mi + 1) || Infinity
              return ae.timestamp >= mTime && ae.timestamp < nextTime
            }))
            if (trailing.length === 0) return null
            return trailing.map((ae) => (
              <div key={ae.id} className="space-y-0.5 pl-1">
                {ae.results.map((r, ri) => {
                  const Icon = ACTION_ICONS[r.type] ?? MousePointerClick
                  return (
                    <div
                      key={ri}
                      className={cn(
                        'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                        r.success
                          ? 'text-emerald-600/80 dark:text-emerald-400/80'
                          : 'text-red-500/80 dark:text-red-400/80'
                      )}
                    >
                      <Icon className="h-2.5 w-2.5 shrink-0" />
                      <span className="font-medium capitalize">{r.type}</span>
                      <span className="truncate opacity-60">{r.description}</span>
                    </div>
                  )
                })}
              </div>
            ))
          })()}

          {sending && (
            <div className="flex items-center gap-2 px-1 py-1">
              <div className="flex gap-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-[10px] text-muted-foreground/50">
                {loopStep > 0 ? `Step ${loopStep}` : 'Thinking'}
              </span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex items-end gap-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI to do something..."
            rows={1}
            className="flex-1 resize-none rounded-lg border-0 bg-muted/50 px-2.5 py-1.5 text-[11px] placeholder:text-muted-foreground/40 focus:bg-muted/80 focus:outline-none focus:ring-1 focus:ring-ring/30 transition-all"
          />
          {sending ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              onClick={handleStop}
            >
              <Square className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                'h-7 w-7 shrink-0 rounded-lg transition-colors',
                input.trim()
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-muted-foreground/30'
              )}
              disabled={!input.trim()}
              onClick={handleSend}
            >
              <Send className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
