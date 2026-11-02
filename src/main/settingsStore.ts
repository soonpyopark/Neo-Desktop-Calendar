import type { CalendarStore } from './calendarStore/CalendarStore'
import type { AppSettings, LaunchMode, WidgetBounds } from '../shared/ipc'

/**
 * Thin adapter over CalendarStore so desktopMode keeps its existing SettingsStore API
 * while Neo persists into MDC-compatible settings.json.
 */
export class SettingsStore {
  constructor(private readonly calendarStore: CalendarStore) {}

  getSettings(): AppSettings {
    return this.calendarStore.getAppSettings()
  }

  patchSettings(patch: Partial<AppSettings>): AppSettings {
    return this.calendarStore.patchAppSettings(patch ?? {})
  }

  getWidgetBounds(): WidgetBounds {
    return this.calendarStore.getWidgetBounds()
  }

  setWidget(
    patch: {
      launchMode?: LaunchMode
      bounds?: WidgetBounds
      displayPlacement?: AppSettings['widget']['displayPlacement']
    }
  ): AppSettings {
    return this.calendarStore.setWidget(patch)
  }

  getAuthSession(): { token: string; loginId: string } | null {
    return this.calendarStore.getAuthSession()
  }

  setAuthSession(session: { token: string; loginId: string } | null): void {
    this.calendarStore.setAuthSession(session)
  }

  listBrowserSessions(): Array<{ token: string; loginId: string }> {
    return this.calendarStore.listBrowserSessions()
  }

  getBrowserSession(token: string | null | undefined): { token: string; loginId: string } | null {
    return this.calendarStore.getBrowserSession(token)
  }

  putBrowserSession(session: { token: string; loginId: string }): void {
    this.calendarStore.putBrowserSession(session)
  }

  deleteBrowserSession(token: string | null | undefined): void {
    this.calendarStore.deleteBrowserSession(token)
  }

  deleteBrowserSessionsForLoginId(loginId: string | null | undefined): void {
    this.calendarStore.deleteBrowserSessionsForLoginId(loginId)
  }
}
