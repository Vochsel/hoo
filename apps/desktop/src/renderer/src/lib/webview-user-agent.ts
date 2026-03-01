const ELECTRON_TOKEN_REGEX = /\sElectron\/[^\s)]+/g

export function getWebviewUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  const base = navigator.userAgent || ''
  return base.replace(ELECTRON_TOKEN_REGEX, '').trim()
}
