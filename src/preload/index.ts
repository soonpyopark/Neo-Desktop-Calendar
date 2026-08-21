import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ClickForwardHitZone,
  ClientHitRect,
  DayCellHitZone,
  DesktopQuickEditContext,
  LoginResult,
  ModeStatus,
  NeoCalendarApi,
  OpacityPreviewPatch,
  OpenDayQuickEditPayload,
  FocusDayCellPayload,
  DayDblClickLogPayload,
  QuickEditDeferToMainPayload,
  ToolbarClickPayload,
  SetIgnoreMouseOptions,
  OpenPanelWindowRequest,
  PanelWindowInit
} from '../shared/ipc'
import type {
  CalendarEvent,
  CalendarRecord,
  CalendarStoreSnapshot,
  EventInput,
  MemberRecord,
  MemberSaveInput,
  StoreSettings,
  TagRecord
} from '../shared/calendarTypes'

const api: NeoCalendarApi = {
  setIgnoreMouse: (ignore: boolean, options: SetIgnoreMouseOptions = { forwardToOverlay: true }) => {
    ipcRenderer.send('set-ignore-mouse', ignore, options)
  },
  getModeStatus: () => ipcRenderer.invoke('get-mode-status') as Promise<ModeStatus>,
  enterDesktop: () => ipcRenderer.invoke('enter-desktop') as Promise<ModeStatus>,
  enterWindow: () => ipcRenderer.invoke('enter-window') as Promise<ModeStatus>,
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  setWindowBounds: (bounds) => ipcRenderer.invoke('set-window-bounds', bounds),
  setWindowModeHitZone: (rect: ClientHitRect | null) => {
    ipcRenderer.send('set-window-mode-hit-zone', rect)
  },
  setHeaderHitZone: (rect: ClientHitRect | null) => {
    ipcRenderer.send('set-header-hit-zone', rect)
  },
  setWakeHitZones: (zones: ClientHitRect[]) => {
    ipcRenderer.send('set-wake-hit-zones', zones)
  },
  setClickForwardHitZones: (zones: ClickForwardHitZone[]) => {
    ipcRenderer.send('set-click-forward-hit-zones', zones)
  },
  setDayCellHitZones: (zones: DayCellHitZone[]) => {
    ipcRenderer.send('set-day-cell-hit-zones', zones)
  },
  setDayDblClickExcludeZones: (zones: ClientHitRect[]) => {
    ipcRenderer.send('set-day-dblclick-exclude-zones', zones)
  },
  setInteractionBusy: (busy: boolean) => {
    ipcRenderer.send('set-interaction-busy', Boolean(busy))
  },
  focusForTextInput: (options) => {
    ipcRenderer.send('focus-for-text-input', options ?? {})
  },
  onModeChanged: (listener: (status: ModeStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ModeStatus): void => {
      listener(status)
    }
    ipcRenderer.on('mode-changed', handler)
    return () => {
      ipcRenderer.removeListener('mode-changed', handler)
    }
  },
  onOpenDayQuickEdit: (listener: (payload: OpenDayQuickEditPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: OpenDayQuickEditPayload
    ): void => {
      listener(payload)
    }
    ipcRenderer.on('open-day-quick-edit', handler)
    return () => {
      ipcRenderer.removeListener('open-day-quick-edit', handler)
    }
  },
  onFocusDayCell: (listener: (payload: FocusDayCellPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: FocusDayCellPayload
    ): void => {
      listener(payload)
    }
    ipcRenderer.on('focus-day-cell', handler)
    return () => {
      ipcRenderer.removeListener('focus-day-cell', handler)
    }
  },
  setDesktopQuickEditContext: (context: DesktopQuickEditContext) => {
    ipcRenderer.send('set-desktop-quick-edit-context', context)
  },
  getQuickEditInit: () =>
    ipcRenderer.invoke('quick-edit-get-init') as ReturnType<NeoCalendarApi['getQuickEditInit']>,
  closeQuickEditWindow: () => {
    ipcRenderer.send('quick-edit-close')
  },
  deferQuickEditToMain: (payload: QuickEditDeferToMainPayload) =>
    ipcRenderer.invoke('quick-edit-defer-to-main', payload) as Promise<boolean>,
  getPanelInit: () =>
    ipcRenderer.invoke('panel-get-init') as ReturnType<NeoCalendarApi['getPanelInit']>,
  openPanelWindow: (request) =>
    ipcRenderer.invoke('panel-open', request) as ReturnType<NeoCalendarApi['openPanelWindow']>,
  closePanelWindow: () => {
    ipcRenderer.send('panel-close')
  },
  closePanelSlot: (kind) => {
    ipcRenderer.send('panel-close-slot', kind)
  },
  blockPanelOutsideClose: (ms) => {
    ipcRenderer.send('panel-block-outside-close', ms)
  },
  closeAfterEventDelete: () => {
    ipcRenderer.send('panel-close-after-event-delete')
  },
  routePanelWindow: (init) =>
    ipcRenderer.invoke('panel-route', init) as ReturnType<NeoCalendarApi['routePanelWindow']>,
  resizePanelWindow: (size) =>
    ipcRenderer.invoke('panel-resize', size) as ReturnType<NeoCalendarApi['resizePanelWindow']>,
  onPanelRequestDismiss: (listener: () => void) => {
    const handler = (): void => {
      listener()
    }
    ipcRenderer.on('panel-request-dismiss', handler)
    return () => {
      ipcRenderer.removeListener('panel-request-dismiss', handler)
    }
  },
  onDayListPreviewOpenChanged: (listener: (open: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, open: boolean): void => {
      listener(Boolean(open))
    }
    ipcRenderer.on('day-list-preview-open-changed', handler)
    return () => {
      ipcRenderer.removeListener('day-list-preview-open-changed', handler)
    }
  },
  onQuickEditDeferred: (listener: (payload: QuickEditDeferToMainPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: QuickEditDeferToMainPayload
    ): void => {
      listener(payload)
    }
    ipcRenderer.on('quick-edit-deferred', handler)
    return () => {
      ipcRenderer.removeListener('quick-edit-deferred', handler)
    }
  },
  onToolbarClick: (listener: (payload: ToolbarClickPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: ToolbarClickPayload
    ): void => {
      listener(payload)
    }
    ipcRenderer.on('toolbar-click', handler)
    return () => {
      ipcRenderer.removeListener('toolbar-click', handler)
    }
  },
  onDayDblClickLog: (listener: (payload: DayDblClickLogPayload) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DayDblClickLogPayload
    ): void => {
      listener(payload)
    }
    ipcRenderer.on('day-dblclick-log', handler)
    return () => {
      ipcRenderer.removeListener('day-dblclick-log', handler)
    }
  },
  onStoreChanged: (listener: () => void) => {
    const handler = (): void => {
      listener()
    }
    ipcRenderer.on('store-changed', handler)
    return () => {
      ipcRenderer.removeListener('store-changed', handler)
    }
  },
  onAuthChanged: (listener: () => void) => {
    const handler = (): void => {
      listener()
    }
    ipcRenderer.on('auth-changed', handler)
    return () => {
      ipcRenderer.removeListener('auth-changed', handler)
    }
  },
  applyMainOpacityPreview: (patch) => {
    ipcRenderer.send('apply-main-opacity-preview', patch)
  },
  onMainOpacityPreview: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, patch: OpacityPreviewPatch): void => {
      listener(patch)
    }
    ipcRenderer.on('main-opacity-preview', handler)
    return () => {
      ipcRenderer.removeListener('main-opacity-preview', handler)
    }
  },
  getAuth: () => ipcRenderer.invoke('get-auth'),
  showDefaultAdminHint: () =>
    ipcRenderer.invoke('auth:show-default-admin-hint') as Promise<boolean>,
  changePassword: (input) =>
    ipcRenderer.invoke('auth:change-password', input) as Promise<{ ok: true }>,
  getSyncInfo: () =>
    ipcRenderer.invoke('get-sync-info') as ReturnType<NeoCalendarApi['getSyncInfo']>,
  startWebServer: (mode) =>
    ipcRenderer.invoke('web-server:start', mode) as ReturnType<NeoCalendarApi['startWebServer']>,
  stopWebServer: () =>
    ipcRenderer.invoke('web-server:stop') as ReturnType<NeoCalendarApi['stopWebServer']>,
  setWebServerHttps: (enabled) =>
    ipcRenderer.invoke('web-server:set-https', enabled) as ReturnType<
      NeoCalendarApi['setWebServerHttps']
    >,
  regenerateWebServerTls: () =>
    ipcRenderer.invoke('web-server:regenerate-tls') as ReturnType<
      NeoCalendarApi['regenerateWebServerTls']
    >,
  exportWebServerCa: () =>
    ipcRenderer.invoke('web-server:export-ca') as ReturnType<NeoCalendarApi['exportWebServerCa']>,
  revealWebServerTlsFolder: () =>
    ipcRenderer.invoke('web-server:reveal-tls-folder') as ReturnType<
      NeoCalendarApi['revealWebServerTlsFolder']
    >,
  allowWebServerFirewall: (port) =>
    ipcRenderer.invoke('web-server:allow-firewall', port) as ReturnType<
      NeoCalendarApi['allowWebServerFirewall']
    >,
  removeWebServerFirewall: (port) =>
    ipcRenderer.invoke('web-server:remove-firewall', port) as ReturnType<
      NeoCalendarApi['removeWebServerFirewall']
    >,
  login: (loginId: string, password: string, remember?: boolean) =>
    ipcRenderer.invoke('login', loginId, password, remember) as Promise<LoginResult>,
  logout: () => ipcRenderer.invoke('logout') as Promise<void>,
  getSettings: () => ipcRenderer.invoke('get-settings') as Promise<AppSettings>,
  patchSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke('patch-settings', patch) as Promise<AppSettings>,
  getCalendarStore: () =>
    ipcRenderer.invoke('calendar:get-store') as Promise<CalendarStoreSnapshot>,
  patchStoreSettings: (patch: Partial<StoreSettings>) =>
    ipcRenderer.invoke('calendar:patch-settings', patch) as Promise<CalendarStoreSnapshot>,
  replaceCalendarStore: (store: CalendarStoreSnapshot) =>
    ipcRenderer.invoke('calendar:replace-store', store) as Promise<CalendarStoreSnapshot>,
  importCalendarStore: (payload: unknown) =>
    ipcRenderer.invoke('calendar:import-store', payload) as Promise<CalendarStoreSnapshot>,
  exportBackupZip: () =>
    ipcRenderer.invoke('calendar:export-backup-zip') as ReturnType<
      NeoCalendarApi['exportBackupZip']
    >,
  importBackupZip: () =>
    ipcRenderer.invoke('calendar:import-backup-zip') as ReturnType<
      NeoCalendarApi['importBackupZip']
    >,
  importBackupZipFromPath: (zipPath: string) =>
    ipcRenderer.invoke('calendar:import-backup-zip-path', zipPath) as ReturnType<
      NeoCalendarApi['importBackupZipFromPath']
    >,
  getStoreBackupStatus: () =>
    ipcRenderer.invoke('store-backup:status') as ReturnType<NeoCalendarApi['getStoreBackupStatus']>,
  saveStoreBackupConfig: (patch) =>
    ipcRenderer.invoke('store-backup:save-config', patch) as ReturnType<
      NeoCalendarApi['saveStoreBackupConfig']
    >,
  runStoreBackupNow: () =>
    ipcRenderer.invoke('store-backup:run-now') as ReturnType<NeoCalendarApi['runStoreBackupNow']>,
  deleteStoreBackup: (fileName) =>
    ipcRenderer.invoke('store-backup:delete', fileName) as ReturnType<
      NeoCalendarApi['deleteStoreBackup']
    >,
  pickStoreBackupDest: () =>
    ipcRenderer.invoke('store-backup:pick-dest') as ReturnType<NeoCalendarApi['pickStoreBackupDest']>,
  exportCalendarZip: (calendarId: string) =>
    ipcRenderer.invoke('calendar:export-calendar-zip', calendarId) as ReturnType<
      NeoCalendarApi['exportCalendarZip']
    >,
  importCalendarZipFromPath: (calendarId: string, zipPath: string) =>
    ipcRenderer.invoke(
      'calendar:import-calendar-zip-path',
      calendarId,
      zipPath
    ) as ReturnType<NeoCalendarApi['importCalendarZipFromPath']>,
  pickCalendarImportFile: () =>
    ipcRenderer.invoke('calendar:pick-import-file') as ReturnType<
      NeoCalendarApi['pickCalendarImportFile']
    >,
  addEvent: (input: EventInput) =>
    ipcRenderer.invoke('calendar:add-event', input) as Promise<CalendarEvent>,
  editEvent: (id: string, patch: Partial<CalendarEvent>) =>
    ipcRenderer.invoke('calendar:edit-event', id, patch) as Promise<CalendarEvent>,
  removeEvent: (id: string) => ipcRenderer.invoke('calendar:remove-event', id) as Promise<void>,
  addEventAttachments: (eventId: string) =>
    ipcRenderer.invoke('calendar:add-attachments', eventId) as Promise<CalendarEvent>,
  addEventAttachmentBuffers: (eventId, uploads) =>
    ipcRenderer.invoke(
      'calendar:add-attachment-buffers',
      eventId,
      uploads
    ) as Promise<CalendarEvent>,
  copyEventAttachments: (sourceEventId: string, targetEventId: string) =>
    ipcRenderer.invoke(
      'calendar:copy-attachments',
      sourceEventId,
      targetEventId
    ) as Promise<CalendarEvent>,
  removeEventAttachment: (eventId: string, attachmentId: string) =>
    ipcRenderer.invoke(
      'calendar:remove-attachment',
      eventId,
      attachmentId
    ) as Promise<CalendarEvent>,
  openEventAttachment: (eventId: string, attachmentId: string) =>
    ipcRenderer.invoke('calendar:open-attachment', eventId, attachmentId) as Promise<void>,
  readEventAttachmentImage: (eventId: string, attachmentId: string) =>
    ipcRenderer.invoke('calendar:read-attachment-image', eventId, attachmentId) as ReturnType<
      NeoCalendarApi['readEventAttachmentImage']
    >,
  createCalendar: (input: Partial<CalendarRecord> & { name: string; color: string }) =>
    ipcRenderer.invoke('calendar:create-calendar', input) as Promise<CalendarRecord>,
  patchCalendar: (id: string, patch: Partial<CalendarRecord>) =>
    ipcRenderer.invoke('calendar:patch-calendar', id, patch) as Promise<CalendarRecord>,
  reorderCalendars: (orderedIds: string[]) =>
    ipcRenderer.invoke('calendar:reorder-calendars', orderedIds) as Promise<CalendarRecord[]>,
  deleteCalendar: (id: string) =>
    ipcRenderer.invoke('calendar:delete-calendar', id) as Promise<void>,
  clearCalendarEvents: (id: string) =>
    ipcRenderer.invoke('calendar:clear-events', id) as Promise<void>,
  importEventsIntoCalendar: (id: string, events: unknown[]) =>
    ipcRenderer.invoke('calendar:import-into-calendar', id, events) as Promise<{
      ok: true
      importedCount: number
      calendarId: string
    }>,
  setTags: (tags: TagRecord[]) =>
    ipcRenderer.invoke('calendar:set-tags', tags) as Promise<TagRecord[]>,
  createTag: (input: { name: string; color: string; sortOrder?: number }) =>
    ipcRenderer.invoke('calendar:create-tag', input) as Promise<TagRecord>,
  patchTag: (id: string, patch: Partial<Pick<TagRecord, 'name' | 'color' | 'sortOrder'>>) =>
    ipcRenderer.invoke('calendar:patch-tag', id, patch) as Promise<TagRecord>,
  deleteTag: (id: string) => ipcRenderer.invoke('calendar:delete-tag', id) as Promise<void>,
  listMembers: () => ipcRenderer.invoke('calendar:list-members') as Promise<MemberRecord[]>,
  saveMembers: (members: MemberSaveInput[]) =>
    ipcRenderer.invoke('calendar:save-members', members) as Promise<MemberRecord[]>,
  syncHolidays: (input) =>
    ipcRenderer.invoke('calendar:sync-holidays', input ?? {}) as ReturnType<
      NeoCalendarApi['syncHolidays']
    >,
  exportCalendar: (input) =>
    ipcRenderer.invoke('calendar:export', input) as ReturnType<NeoCalendarApi['exportCalendar']>,
  getDataRoot: () => ipcRenderer.invoke('calendar:get-data-root') as Promise<string>,
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url) as Promise<void>,
  checkForUpdates: () =>
    ipcRenderer.invoke('check-for-updates') as ReturnType<NeoCalendarApi['checkForUpdates']>
}

contextBridge.exposeInMainWorld('neoCalendar', api)

export type { NeoCalendarApi, SetIgnoreMouseOptions }
