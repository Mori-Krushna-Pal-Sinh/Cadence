import { AnimatePresence, motion } from 'motion/react'
import { BarChart3, CalendarDays, Layers, Moon, Settings as SettingsIcon, Sun, SunMedium } from 'lucide-react'
import { useEffect } from 'react'
import { Activities } from './features/Activities'
import { Calendar } from './features/Calendar'
import { Detail } from './features/Detail'
import { Editor } from './features/Editor'
import { MigrationPrompt } from './features/MigrationPrompt'
import { Review } from './features/Review'
import { Settings } from './features/Settings'
import { Today } from './features/Today'
import { isDemo } from './store/persist'
import { setTheme, useStore, type Theme } from './store/store'
import { openEditor, useUI } from './store/ui'
import { isTyping, navigate, useMediaQuery, useRoute, type Route } from './ui/hooks'
import { hideTip, Logo, Toasts, TooltipLayer } from './ui/primitives'

const NAV: { route: Route; label: string; icon: typeof Sun; key: string }[] = [
  { route: 'today', label: 'Today', icon: SunMedium, key: '1' },
  { route: 'activities', label: 'Activities', icon: Layers, key: '2' },
  { route: 'review', label: 'Review', icon: BarChart3, key: '3' },
  { route: 'calendar', label: 'Calendar', icon: CalendarDays, key: '4' },
]

function useThemeEffect() {
  const theme = useStore((s) => s.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  useEffect(() => {
    const dark = theme === 'dark' || (theme === 'system' && systemDark)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151412' : '#f4f1ea')
  }, [theme, systemDark])
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (useUI.getState().editor || useUI.getState().detailId) return
      const nav = NAV.find((n) => n.key === e.key)
      if (nav) { navigate(nav.route); return }
      if (e.key === 'n' || e.key === '/') {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('#quick-add')
        if (input) input.focus()
        else openEditor({ draft: {} })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  const route = useRoute()
  const theme = useStore((s) => s.theme)
  useThemeEffect()
  useShortcuts()
  useEffect(() => { useUI.setState({ detailId: null, editor: null }); hideTip() }, [route])

  const cycleTheme = () => setTheme((({ system: 'light', light: 'dark', dark: 'system' }) as Record<Theme, Theme>)[theme])
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMedium

  return (
    <div className="app">
      <div className="grain" aria-hidden />
      <aside className="sidebar">
        <a className="brand" href="#/today" aria-label="Cadence home">
          <Logo size={26} />
          <span className="brand-name">Cadence</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map(({ route: r, label, icon: Icon, key }) => (
            <a key={r} href={`#/${r}`} className="nav-item" aria-current={route === r ? 'page' : undefined}>
              {route === r && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              <kbd>{key}</kbd>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <a href="#/settings" className="nav-item" aria-current={route === 'settings' ? 'page' : undefined}>
            {route === 'settings' && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }} />}
            <SettingsIcon size={17} strokeWidth={1.8} />
            <span>Settings</span>
          </a>
          <button className="nav-item" onClick={cycleTheme} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`}>
            <ThemeIcon size={17} strokeWidth={1.8} />
            <span className="cap">{theme} theme</span>
          </button>
        </div>
      </aside>

      <main className="main">
        {isDemo && (
          <div className="demo-banner">
            Sample data — nothing here touches your real data. <a href={location.pathname + location.hash}>Exit sample</a>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={route}
            className="page"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
          >
            {route === 'today' && <Today />}
            {route === 'activities' && <Activities />}
            {route === 'review' && <Review />}
            {route === 'calendar' && <Calendar />}
            {route === 'settings' && <Settings />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar" aria-label="Main">
        {[...NAV, { route: 'settings' as Route, label: 'Settings', icon: SettingsIcon, key: '' }].map(({ route: r, label, icon: Icon }) => (
          <a key={r} href={`#/${r}`} className="tab" aria-current={route === r ? 'page' : undefined}>
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <Detail />
      <Editor />
      <MigrationPrompt />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}