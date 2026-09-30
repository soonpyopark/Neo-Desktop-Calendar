import { useEffect, useState, type ReactElement } from 'react'
import { WallpaperContainer } from './components/WallpaperContainer'
import { CalendarGrid } from './components/CalendarGrid'
import { WindowResizeHandles } from './components/WindowResizeHandles'
import {
  fetchAuthUser,
  isBrowserNeoCalendarHost,
  subscribeAuthUserSync
} from './lib/browserNeoCalendar'
import { applyOpacitySettings } from './lib/opacitySettings'
import { useAppDialog } from './components/AppDialogProvider'
import { runStartupUpdateCheck } from './lib/updateCheckUi'
import type { AppSettings, AuthUser, LaunchMode, ModeStatus } from '../../shared/ipc'

export default function App(): ReactElement {
  const { alert, confirm, choice } = useAppDialog()
  const [mode, setMode] = useState<LaunchMode>('window')
  /** True only while WorkerW-embedded (not while temporarily undocked). */
  const [embedded, setEmbedded] = useState(false)
  const [switchReady, setSwitchReady] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    // Match first-run defaults before settings IPC returns.
    document.documentElement.style.setProperty('--neo-header-opacity', '1')
    document.documentElement.style.setProperty('--neo-shell-opacity', '1')

    const api = window.neoCalendar
    if (!api) {
      setAuthReady(true)
      return
    }

    void api.getModeStatus().then((status: ModeStatus) => {
      setMode(status.mode)
      setEmbedded(status.embedded)
      setSwitchReady(status.switchReady !== false)
    })
    void fetchAuthUser().then((next) => {
      setUser(next)
      setAuthReady(true)
    })
    void api.getSettings().then((next) => {
      setSettings(next)
      applyOpacitySettings(next)
    })

    const refreshOpacityFromStore = (): void => {
      void api.getSettings().then((next) => {
        setSettings(next)
        applyOpacitySettings(next)
      })
    }

    const unsubMode = api.onModeChanged((status) => {
      setMode(status.mode)
      setEmbedded(status.embedded)
      setSwitchReady(status.switchReady !== false)
    })
    const unsubOpacity = api.onMainOpacityPreview?.((patch) => {
      applyOpacitySettings(patch)
    })
    const unsubStore = api.onStoreChanged(refreshOpacityFromStore)
    const unsubAuth = subscribeAuthUserSync(setUser)

    return () => {
      unsubMode()
      unsubOpacity?.()
      unsubStore()
      unsubAuth?.()
    }
  }, [])

  useEffect(() => {
    if (!authReady) return undefined
    const timer = window.setTimeout(() => {
      void runStartupUpdateCheck({ alert, confirm, choice })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [alert, authReady, choice, confirm])

  const handleSettingsSaved = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.neoCalendar.patchSettings(patch)
    setSettings(next)
    applyOpacitySettings(next)
  }

  // Undocked desktop: inline overlays. Embedded desktop + window mode: floating panel windows.
  const clickThrough = mode === 'desktop' && embedded

  return (
    <WallpaperContainer clickThrough={clickThrough}>
      <CalendarGrid
        mode={mode}
        embedded={embedded}
        switchReady={switchReady}
        user={user}
        authReady={authReady}
        settings={settings}
        onUserChange={setUser}
        onModeChange={setMode}
        onSettingsSaved={handleSettingsSaved}
      />
      {mode === 'window' && !isBrowserNeoCalendarHost() ? <WindowResizeHandles /> : null}
    </WallpaperContainer>
  )
}
