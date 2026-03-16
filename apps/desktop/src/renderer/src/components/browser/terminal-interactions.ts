import type { Terminal } from '@xterm/xterm'

type RendererDropFile = File & { path?: string }

const WINDOWS_DRIVE_PATH = /^\/([A-Za-z]:\/.*)$/

function currentPlatform(): 'darwin' | 'linux' | 'win32' {
  if (navigator.userAgent.includes('Windows')) return 'win32'
  if (navigator.userAgent.includes('Linux')) return 'linux'
  return 'darwin'
}

function shellQuotePath(filePath: string): string {
  if (currentPlatform() === 'win32') {
    return `'${filePath.replace(/'/g, "''")}'`
  }
  return `'${filePath.replace(/'/g, `'\"'\"'`)}'`
}

function fileUrlToPath(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'file:') return null

    const decodedPath = decodeURIComponent(parsed.pathname)
    if (currentPlatform() === 'win32') {
      const normalized = WINDOWS_DRIVE_PATH.test(decodedPath)
        ? decodedPath.replace(WINDOWS_DRIVE_PATH, '$1')
        : decodedPath
      const withSeparators = normalized.replace(/\//g, '\\')
      return parsed.host ? `\\\\${parsed.host}${withSeparators}` : withSeparators
    }

    return decodedPath
  } catch {
    return null
  }
}

function extractPathsFromUriList(rawList: string): string[] {
  return rawList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(fileUrlToPath)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

function extractPathsFromHtml(rawHtml: string): string[] {
  if (!rawHtml.trim()) return []
  try {
    const doc = new DOMParser().parseFromString(rawHtml, 'text/html')
    const values = Array.from(doc.querySelectorAll('[src], [href]'))
      .flatMap((element) => [element.getAttribute('src'), element.getAttribute('href')])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    return values
      .map(fileUrlToPath)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    return []
  }
}

function fallbackDroppedFileName(file: File): string {
  const trimmedName = file.name.trim()
  if (trimmedName) return trimmedName

  switch (file.type) {
    case 'image/jpeg':
      return 'dropped-image.jpg'
    case 'image/webp':
      return 'dropped-image.webp'
    case 'image/gif':
      return 'dropped-image.gif'
    case 'image/svg+xml':
      return 'dropped-image.svg'
    case 'image/png':
      return 'dropped-image.png'
    default:
      return 'dropped-file'
  }
}

async function resolveDroppedFilePath(file: File): Promise<string | null> {
  const electronFile = file as RendererDropFile
  if (typeof electronFile.path === 'string' && electronFile.path.trim().length > 0) {
    return electronFile.path
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) return null

  try {
    return await window.api.terminal.materializeDroppedFile(fallbackDroppedFileName(file), bytes)
  } catch {
    return null
  }
}

async function collectDroppedPaths(dataTransfer: DataTransfer): Promise<string[]> {
  const uniquePaths = new Set<string>()
  const fileCandidates =
    dataTransfer.files.length > 0
      ? Array.from(dataTransfer.files)
      : Array.from(dataTransfer.items)
          .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
          .filter((file): file is File => file instanceof File)

  for (const file of fileCandidates) {
    const resolvedPath = await resolveDroppedFilePath(file)
    if (resolvedPath) uniquePaths.add(resolvedPath)
  }

  const uriList = dataTransfer.getData('text/uri-list')
  for (const filePath of extractPathsFromUriList(uriList)) {
    uniquePaths.add(filePath)
  }

  const html = dataTransfer.getData('text/html')
  for (const filePath of extractPathsFromHtml(html)) {
    uniquePaths.add(filePath)
  }

  return Array.from(uniquePaths)
}

export function canAcceptTerminalDrop(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  if (dataTransfer.files.length > 0) return true

  const types = new Set(Array.from(dataTransfer.types ?? []))
  return types.has('Files') || types.has('text/uri-list') || types.has('text/html')
}

export async function writeDroppedItemsToTerminal(sessionId: string, dataTransfer: DataTransfer): Promise<boolean> {
  const filePaths = await collectDroppedPaths(dataTransfer)
  if (filePaths.length === 0) return false

  const payload = `${filePaths.map(shellQuotePath).join(' ')} `
  await window.api.terminal.write(sessionId, payload)
  return true
}

function isPlainShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  )
}

function isCloseTabShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'w' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  )
}

function sendShiftEnterLineBreak(term: Terminal, sessionId: string): void {
  if (term.modes.bracketedPasteMode) {
    // Avoid xterm's paste path so apps don't show a "pasting text" banner.
    window.api.terminal.write(sessionId, '\n').catch(() => {})
    return
  }

  // Fallback to xterm's native Alt+Enter sequence when bracketed paste isn't active.
  window.api.terminal.write(sessionId, '\x1b\r').catch(() => {})
}

export function installTerminalKeyBindings(
  term: Terminal,
  sessionId: string,
  host: HTMLElement,
  onRequestClose?: () => void
): () => void {
  let suppressNextInputEvent = false

  const handleKeydownCapture = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return
    if (isCloseTabShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onRequestClose?.()
      return
    }
    if (!isPlainShiftEnter(event)) return

    suppressNextInputEvent = true
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    sendShiftEnterLineBreak(term, sessionId)
  }

  const handleInputCapture = (event: Event): void => {
    if (!(event instanceof InputEvent)) return
    if (!suppressNextInputEvent && event.inputType !== 'insertLineBreak') return

    suppressNextInputEvent = false
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const resetSuppression = (): void => {
    suppressNextInputEvent = false
  }

  host.addEventListener('keydown', handleKeydownCapture, true)
  host.addEventListener('keypress', handleKeydownCapture, true)
  host.addEventListener('beforeinput', handleInputCapture, true)
  host.addEventListener('input', handleInputCapture, true)
  host.addEventListener('keyup', resetSuppression, true)

  term.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && isCloseTabShortcut(event)) {
      return false
    }

    if (event.type === 'keydown' && isPlainShiftEnter(event)) {
      return false
    }

    if (event.ctrlKey && event.key === 'Tab') {
      return false
    }

    return true
  })

  return () => {
    host.removeEventListener('keydown', handleKeydownCapture, true)
    host.removeEventListener('keypress', handleKeydownCapture, true)
    host.removeEventListener('beforeinput', handleInputCapture, true)
    host.removeEventListener('input', handleInputCapture, true)
    host.removeEventListener('keyup', resetSuppression, true)
  }
}
