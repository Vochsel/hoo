import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'

window.addEventListener('error', (event) => {
  console.error('[renderer:error]', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer:unhandledrejection]', event.reason)
})

// Add platform class so CSS can distinguish macOS (vibrancy) from Windows/Linux
const platform = navigator.userAgent.includes('Windows') ? 'win32'
  : navigator.userAgent.includes('Linux') ? 'linux'
  : 'darwin'
document.documentElement.classList.add(`platform-${platform}`)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
