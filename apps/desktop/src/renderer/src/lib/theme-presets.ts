// ─── Theme Preset Definitions ──────────────────────────────────────────────

export interface ThemeColors {
  accent: string     // hex
  background: string // hex
  foreground: string // hex
}

export interface ThemePreset {
  id: string
  name: string
  light: ThemeColors
  dark: ThemeColors
  uiFont?: string
  codeFont?: string
}

export interface ThemeCustomization {
  preset: string
  colors: { light: ThemeColors; dark: ThemeColors }
  uiFont: string
  codeFont: string
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'default',
    name: 'Default',
    light: { accent: '#1a2744', background: '#f5f6f8', foreground: '#0c1222' },
    dark: { accent: '#d4dae4', background: '#0c1222', foreground: '#f0f2f5' },
  },
  {
    id: 'nord',
    name: 'Nord',
    light: { accent: '#5e81ac', background: '#eceff4', foreground: '#2e3440' },
    dark: { accent: '#88c0d0', background: '#2e3440', foreground: '#d8dee9' },
    uiFont: 'Inter',
    codeFont: 'JetBrains Mono',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    light: { accent: '#9b59b6', background: '#f8f8f2', foreground: '#282a36' },
    dark: { accent: '#ff79c6', background: '#282a36', foreground: '#f8f8f2' },
    uiFont: 'Inter',
    codeFont: 'Fira Code',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    light: { accent: '#8839ef', background: '#eff1f5', foreground: '#4c4f69' },
    dark: { accent: '#cba6f7', background: '#1e1e2e', foreground: '#cdd6f4' },
    uiFont: 'DM Sans',
    codeFont: 'JetBrains Mono',
  },
  {
    id: 'everforest',
    name: 'Everforest',
    light: { accent: '#8da101', background: '#fdf6e3', foreground: '#5c6a72' },
    dark: { accent: '#a7c080', background: '#2d353b', foreground: '#d3c6aa' },
    uiFont: 'IBM Plex Sans',
    codeFont: 'IBM Plex Mono',
  },
  {
    id: 'solarized',
    name: 'Solarized',
    light: { accent: '#268bd2', background: '#fdf6e3', foreground: '#657b83' },
    dark: { accent: '#268bd2', background: '#002b36', foreground: '#839496' },
    uiFont: 'Source Sans 3',
    codeFont: 'Source Code Pro',
  },
  {
    id: 'one',
    name: 'One',
    light: { accent: '#4078f2', background: '#fafafa', foreground: '#383a42' },
    dark: { accent: '#61afef', background: '#282c34', foreground: '#abb2bf' },
    uiFont: 'Inter',
    codeFont: 'JetBrains Mono',
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    light: { accent: '#d65d0e', background: '#fbf1c7', foreground: '#3c3836' },
    dark: { accent: '#fe8019', background: '#282828', foreground: '#ebdbb2' },
    uiFont: 'IBM Plex Sans',
    codeFont: 'IBM Plex Mono',
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    light: { accent: '#7aa2f7', background: '#d5d6db', foreground: '#343b58' },
    dark: { accent: '#7aa2f7', background: '#1a1b26', foreground: '#c0caf5' },
    uiFont: 'Plus Jakarta Sans',
    codeFont: 'Fira Code',
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    light: { accent: '#d7827e', background: '#faf4ed', foreground: '#575279' },
    dark: { accent: '#ebbcba', background: '#191724', foreground: '#e0def4' },
    uiFont: 'DM Sans',
    codeFont: 'JetBrains Mono',
  },
  {
    id: 'github',
    name: 'GitHub',
    light: { accent: '#0969da', background: '#ffffff', foreground: '#1f2328' },
    dark: { accent: '#58a6ff', background: '#0d1117', foreground: '#e6edf3' },
    uiFont: 'Inter',
    codeFont: 'JetBrains Mono',
  },
  {
    id: 'monokai',
    name: 'Monokai',
    light: { accent: '#f92672', background: '#fafafa', foreground: '#49483e' },
    dark: { accent: '#f92672', background: '#272822', foreground: '#f8f8f2' },
    codeFont: 'Fira Code',
  },
]

// ─── Color Utilities ──────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

function mixHex(hex1: string, hex2: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex1)
  const [r2, g2, b2] = hexToRgb(hex2)
  return rgbToHex(
    r1 + (r2 - r1) * amount,
    g1 + (g2 - g1) * amount,
    b1 + (b2 - b1) * amount,
  )
}

export function hexToHsl(hex: string): string {
  const [rr, gg, bb] = hexToRgb(hex)
  const r = rr / 255
  const g = gg / 255
  const b = bb / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`
}

// ─── CSS Variable Generation ──────────────────────────────────────────────

const CSS_VAR_KEYS = [
  '--background', '--foreground',
  '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
] as const

export function generateCssVars(
  accent: string,
  background: string,
  foreground: string,
  isDark: boolean,
): Record<string, string> {
  const muted = mixHex(background, foreground, isDark ? 0.12 : 0.06)
  const mutedFg = mixHex(background, foreground, isDark ? 0.70 : 0.55)
  const secondary = mixHex(background, foreground, isDark ? 0.10 : 0.04)
  const border = mixHex(background, foreground, isDark ? 0.12 : 0.15)
  const destructive = isDark ? '#9b2c2c' : '#e53e3e'
  const destructiveFg = isDark ? '#fed7d7' : '#ffffff'

  return {
    '--background': hexToHsl(background),
    '--foreground': hexToHsl(foreground),
    '--card': hexToHsl(background),
    '--card-foreground': hexToHsl(foreground),
    '--popover': hexToHsl(background),
    '--popover-foreground': hexToHsl(foreground),
    '--primary': hexToHsl(accent),
    '--primary-foreground': hexToHsl(background),
    '--secondary': hexToHsl(secondary),
    '--secondary-foreground': hexToHsl(foreground),
    '--muted': hexToHsl(muted),
    '--muted-foreground': hexToHsl(mutedFg),
    '--accent': hexToHsl(secondary),
    '--accent-foreground': hexToHsl(foreground),
    '--destructive': hexToHsl(destructive),
    '--destructive-foreground': hexToHsl(destructiveFg),
    '--border': hexToHsl(border),
    '--input': hexToHsl(border),
    '--ring': hexToHsl(accent),
  }
}

// ─── Apply / Clear ────────────────────────────────────────────────────────

export function applyThemeCustomization(
  customization: ThemeCustomization,
  resolved: 'light' | 'dark',
): void {
  const colors = resolved === 'dark' ? customization.colors.dark : customization.colors.light
  const vars = generateCssVars(colors.accent, colors.background, colors.foreground, resolved === 'dark')
  const root = document.documentElement

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }

  // Fonts
  if (customization.uiFont) {
    loadGoogleFont(customization.uiFont)
    document.body.style.fontFamily = `"${customization.uiFont}", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  } else {
    document.body.style.fontFamily = ''
  }

  if (customization.codeFont) {
    loadGoogleFont(customization.codeFont)
  }
}

export function clearThemeCustomization(): void {
  const root = document.documentElement
  for (const key of CSS_VAR_KEYS) {
    root.style.removeProperty(key)
  }
  document.body.style.fontFamily = ''
}

// ─── Google Fonts Loader ──────────────────────────────────────────────────

const loadedFonts = new Set<string>()

export function loadGoogleFont(fontName: string): void {
  if (!fontName || loadedFonts.has(fontName)) return
  loadedFonts.add(fontName)

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700&display=swap`
  document.head.appendChild(link)
}

export function getPresetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id)
}

export function makeDefaultCustomization(): ThemeCustomization {
  const preset = THEME_PRESETS[0]
  return {
    preset: preset.id,
    colors: { light: { ...preset.light }, dark: { ...preset.dark } },
    uiFont: preset.uiFont ?? '',
    codeFont: preset.codeFont ?? '',
  }
}
