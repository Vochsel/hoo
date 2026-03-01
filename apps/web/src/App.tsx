import {
  Layers,
  Bot,
  Workflow,
  Globe,
  MonitorSmartphone,
  Sparkles,
  Github,
  ArrowRight,
  Download
} from 'lucide-react'

const features = [
  {
    icon: Layers,
    title: 'Spatial Canvas',
    description: 'Arrange your tabs as nodes on an infinite canvas. Group, connect, and navigate visually.'
  },
  {
    icon: Bot,
    title: 'AI Agent Integration',
    description: 'Built-in AI agents that can browse, extract, and act across your open tabs autonomously.'
  },
  {
    icon: Workflow,
    title: 'Visual Workflows',
    description: 'Connect tabs into executable graphs. Automate multi-step browser tasks with drag and drop.'
  },
  {
    icon: Globe,
    title: 'Full Browser Engine',
    description: 'Chromium-powered webviews with dev tools, extensions support, and full web compatibility.'
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
  return (
    <div className="min-h-screen bg-neutral-950">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <span className="text-lg font-semibold tracking-tight">Hoo</span>
        <a
          href="https://github.com/Vochsel/hoo"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <Github className="w-4 h-4" />
          View on GitHub
        </a>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 pt-24 pb-32 max-w-3xl mx-auto">
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1]">
          Spatial Tabs
        </h1>
        <p className="mt-4 text-lg sm:text-xl text-neutral-400 max-w-xl">
          The true browser for AI. Arrange tabs on a canvas, wire them into workflows, and let
          agents do the rest.
        </p>
        <div className="flex gap-3 mt-8">
          <a
            href="https://github.com/Vochsel/hoo/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-white text-neutral-950 font-medium text-sm hover:bg-neutral-200 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </a>
          <a
            href="https://github.com/Vochsel/hoo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-neutral-800 text-sm font-medium text-neutral-300 hover:border-neutral-600 hover:text-white transition-colors"
          >
            Learn More
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-neutral-800/60 bg-neutral-900/40 p-6 hover:border-neutral-700 transition-colors"
            >
              <f.icon className="w-5 h-5 text-neutral-400 mb-3" />
              <h3 className="font-semibold text-sm mb-1">{f.title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-800/60 py-8 text-center text-sm text-neutral-600">
        Hoo &mdash; Open Source
      </footer>
    </div>
  )
}
