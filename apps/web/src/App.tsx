import {
  Layers,
  Bot,
  Workflow,
  Globe,
  MonitorSmartphone,
  Sparkles,
  Github,
  ArrowRight,
  Download,
  Star,
  Sun,
  Moon
} from 'lucide-react'
import { useGitHubStars } from './useGitHubStars'
import { useTheme } from './useTheme'

function OwlLogo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 15 L9 8" />
      <path d="M35 15 L39 8" />
      <path d="M13 15 C6 19 3 26 3 33 C3 41 12 46 24 46 C36 46 45 41 45 33 C45 26 42 19 35 15 C31 11 28 9 24 9 C20 9 17 11 13 15 Z" />
      <circle cx="16" cy="28" r="7" />
      <circle cx="16" cy="28" r="3" fill="currentColor" stroke="none" />
      <circle cx="32" cy="28" r="7" />
      <circle cx="32" cy="28" r="3" fill="currentColor" stroke="none" />
      <path d="M21 35 L24 40 L27 35" />
    </svg>
  )
}

const features = [
  {
    icon: Layers,
    title: 'Spatial Canvas',
    description: 'Arrange tabs as nodes on an infinite canvas. Group, connect, and navigate visually.'
  },
  {
    icon: Bot,
    title: 'AI Agents',
    description: 'Built-in agents that browse, extract, and act across your open tabs autonomously.'
  },
  {
    icon: Workflow,
    title: 'Visual Workflows',
    description: 'Wire tabs into executable graphs. Automate multi-step browser tasks with drag and drop.'
  },
  {
    icon: Globe,
    title: 'Full Browser Engine',
    description: 'Chromium-powered webviews with dev tools, extensions, and full web compatibility.'
  },
  {
    icon: MonitorSmartphone,
    title: 'Cross-Platform',
    description: 'Native desktop app for macOS and Windows. Fast, local, and private by default.'
  },
  {
    icon: Sparkles,
    title: 'AI-Native UX',
    description: 'Every interaction designed for human-AI collaboration. Chat, command, or let agents drive.'
  }
]

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const { formatted } = useGitHubStars()

  return (
    <>
      <div className="min-h-screen">
        {/* Nav */}
        <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <OwlLogo className="w-7 h-7" />
            <span className="text-lg tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>Hoo</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/Vochsel/hoo"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              <Github className="w-4 h-4" />
              {formatted !== null && (
                <span className="inline-flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  {formatted}
                </span>
              )}
            </a>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </nav>

        {/* Hero */}
        <section className="flex flex-col items-center text-center px-6 pt-24 pb-32 max-w-3xl mx-auto overflow-visible">
          <div className="flex items-center gap-4 mb-6">
            <OwlLogo className="w-16 h-16 text-neutral-800 dark:text-neutral-200" />
            <span
              className="text-5xl sm:text-6xl tracking-tight"
              style={{ fontFamily: "'DM Serif Display', serif" }}
            >
              Hoo
            </span>
          </div>
          <h1
            className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1]"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Spatial Tabs
          </h1>
          <p className="mt-4 text-lg sm:text-xl text-neutral-500 dark:text-neutral-400 max-w-xl">
            Browse the web the way your mind works. Group tabs spatially, in a document,
            or in a traditional tab layout.
          </p>
          <div className="flex gap-3 mt-8">
            <a
              href="https://github.com/Vochsel/hoo/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 font-medium text-sm hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
            <a
              href="https://github.com/Vochsel/hoo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-neutral-300 dark:border-neutral-800 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              Learn More
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Hero Image */}
          <div className="mt-16 w-[200%] max-w-none">
            <img
              src="/hero.png"
              alt="Hoo — Visual Browser Workspace"
              className="w-full"
            />
          </div>
        </section>

        {/* Features */}
        <section className="max-w-5xl mx-auto px-6 pb-32">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-center mb-12">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-neutral-200/60 dark:border-neutral-800/60 bg-white/40 dark:bg-neutral-900/40 backdrop-blur-sm p-6 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
              >
                <f.icon className="w-5 h-5 text-neutral-400 mb-3" />
                <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-sm text-neutral-500 leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Mission */}
        <section className="max-w-3xl mx-auto px-6 pb-32">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-center mb-12">Why a Browser?</h2>
          <div className="space-y-6 text-base sm:text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
            <p>
              APIs seem great on paper. But after two years of wrangling OAuth logins and
              integrations, the reality is clear: there are too many gaps in API coverage, too many
              tools with no programmatic access at all. Browser-use is the real path to automating
              knowledge work.
            </p>
            <p>
              Hoo starts from a simple idea &mdash; <em>tabs as nodes</em>. Inspired by the power of
              node graphs in tools like Houdini, where complexity is tamed through visual,
              hierarchical abstraction. Every tab becomes a step. Every connection becomes a workflow.
              Every workflow becomes repeatable and introspectable.
            </p>
            <p>
              This isn't just a browser with AI bolted on. It's a spatial interface where humans and
              agents collaborate in the same canvas, on the same tasks, using the same web everyone
              already knows.
            </p>
            <p className="text-neutral-900 dark:text-white font-medium">&mdash; Ben</p>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-neutral-200/60 dark:border-neutral-800/60 py-8 text-center text-sm text-neutral-400 dark:text-neutral-600">
          <div className="flex items-center justify-center gap-2">
            <OwlLogo className="w-4 h-4" />
            <span>Hoo &mdash; Open Source</span>
          </div>
        </footer>
      </div>
    </>
  )
}
