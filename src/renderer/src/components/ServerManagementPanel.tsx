import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { StoreSettings } from '../../../shared/calendarTypes'
import { emptyTlsStatus, type WebServerSyncInfo } from '../../../shared/httpsConfig'
import {
  DEFAULT_WEB_SERVER_PORT,
  normalizeWebServerMode,
  normalizeWebServerPort,
  resolveWebServerPort,
  type WebServerMode
} from '../../../shared/webServerPort'
import { useAppDialog } from './AppDialogProvider'

const emptySync = (configuredPort = DEFAULT_WEB_SERVER_PORT): WebServerSyncInfo => ({
  running: false,
  port: null,
  configuredPort,
  preferredMode: 'local',
  hostname: null,
  lanMode: false,
  addresses: [],
  editorUrl: null,
  httpsEnabled: false,
  tls: emptyTlsStatus()
})

function modeLabel(info: WebServerSyncInfo): string {
  if (!info.running) {
    const scope =
      info.preferredMode === 'lan'
        ? '중지됨 · 다음 기동 Web (LAN)'
        : '중지됨 · 다음 기동 Local'
    return info.httpsEnabled ? `${scope} · HTTPS` : scope
  }
  const scope = info.lanMode ? 'Web (LAN)' : 'Local (127.0.0.1)'
  return info.httpsEnabled ? `${scope} · HTTPS` : scope
}

export type ServerManagementPanelProps = {
  settings: StoreSettings
  onSaveSettings: (patch: Partial<StoreSettings>) => Promise<void>
}

/** Super-admin: port, start/stop local·LAN HTTP server, Windows firewall rules. */
export function ServerManagementPanel({
  settings,
  onSaveSettings
}: ServerManagementPanelProps): ReactElement {
  const { alert, confirm } = useAppDialog()
  const initialPort = resolveWebServerPort(settings.webServerPort, null)
  const [sync, setSync] = useState<WebServerSyncInfo>(() => emptySync(initialPort))
  const [portDraft, setPortDraft] = useState(String(initialPort))
  const [busy, setBusy] = useState(false)
  const api = typeof window !== 'undefined' ? window.neoCalendar : null

  useEffect(() => {
    const fromStore = normalizeWebServerPort(settings.webServerPort)
    if (fromStore != null) {
      setPortDraft(String(fromStore))
      return
    }
    setPortDraft(String(sync.configuredPort || DEFAULT_WEB_SERVER_PORT))
  }, [settings.webServerPort, sync.configuredPort])

  const refresh = useCallback(async (): Promise<WebServerSyncInfo> => {
    if (!api?.getSyncInfo) {
      const fallback = emptySync(resolveWebServerPort(settings.webServerPort, null))
      const preferred = normalizeWebServerMode(settings.webServerMode)
      if (preferred) fallback.preferredMode = preferred
      fallback.httpsEnabled = settings.httpsEnabled === true
      setSync(fallback)
      return fallback
    }
    const info = await api.getSyncInfo()
    setSync(info)
    return info
  }, [api, settings.httpsEnabled, settings.webServerMode, settings.webServerPort])

  useEffect(() => {
    void refresh().catch(() => {
      const fallback = emptySync(resolveWebServerPort(settings.webServerPort, null))
      const preferred = normalizeWebServerMode(settings.webServerMode)
      if (preferred) fallback.preferredMode = preferred
      fallback.httpsEnabled = settings.httpsEnabled === true
      setSync(fallback)
    })
  }, [refresh, settings.httpsEnabled, settings.webServerMode, settings.webServerPort])

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const draftPortOrAlert = async (): Promise<number | null> => {
    const port = normalizeWebServerPort(portDraft)
    if (port == null) {
      await alert('포트는 1~65535 사이 숫자여야 합니다.')
      return null
    }
    return port
  }

  const persistPort = async (port: number, mode?: WebServerMode): Promise<void> => {
    const patch: Partial<StoreSettings> = { webServerPort: port }
    if (mode) patch.webServerMode = mode
    await onSaveSettings(patch)
  }

  const savePort = (): void => {
    void run(async () => {
      const port = await draftPortOrAlert()
      if (port == null) return
      const prevRunning = sync.running
      const restartMode: WebServerMode = prevRunning
        ? sync.lanMode
          ? 'lan'
          : 'local'
        : (normalizeWebServerMode(settings.webServerMode) ?? sync.preferredMode)
      try {
        await persistPort(port, restartMode)
        let nextSync = await refresh()
        if (prevRunning && api?.startWebServer) {
          const result = await api.startWebServer(restartMode)
          nextSync = result.sync
          setSync(nextSync)
          await alert(
            result.ok
              ? `포트를 ${port}(으)로 저장하고 서버를 다시 시작했습니다.\n${result.message}`
              : `포트는 저장했지만 서버 재시작에 실패했습니다.\n${result.message}`
          )
          return
        }
        await alert(
          `포트를 ${port}(으)로 저장했습니다.\n앱 재시작·서버 시작 시 .env보다 이 값이 우선합니다.`
        )
      } catch (err) {
        await alert(err instanceof Error ? err.message : '포트를 저장하지 못했습니다.')
        await refresh()
      }
    })
  }

  const startMode = (mode: WebServerMode): void => {
    void run(async () => {
      if (!api?.startWebServer) {
        await alert('Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      const port = await draftPortOrAlert()
      if (port == null) return
      try {
        await persistPort(port, mode)
        const result = await api.startWebServer(mode)
        setSync(result.sync)
        await alert(result.message)
      } catch (err) {
        await alert(
          err instanceof Error
            ? err.message
            : mode === 'lan'
              ? 'Web(LAN) 서버를 시작하지 못했습니다.'
              : 'Local 서버를 시작하지 못했습니다.'
        )
        await refresh()
      }
    })
  }

  const stopServer = (): void => {
    void run(async () => {
      if (!api?.stopWebServer) {
        await alert('Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      try {
        const result = await api.stopWebServer()
        setSync(result.sync)
        await alert(result.message)
      } catch (err) {
        await alert(err instanceof Error ? err.message : '서버를 중지하지 못했습니다.')
        await refresh()
      }
    })
  }

  const toggleHttps = (): void => {
    void run(async () => {
      if (!api?.setWebServerHttps) {
        await alert('Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      const enable = !sync.httpsEnabled
      if (enable) {
        const ok = await confirm(
          'HTTPS를 켜면 서버가 다시 시작됩니다. 다른 기기 브라우저는 CA 인증서를 설치해야 자물쇠가 정상입니다. 계속할까요?',
          { confirmLabel: '켜기' }
        )
        if (!ok) return
      }
      try {
        const result = await api.setWebServerHttps(enable)
        setSync(result.sync)
        await alert(result.message)
      } catch (err) {
        await alert(err instanceof Error ? err.message : 'HTTPS 설정을 바꾸지 못했습니다.')
        await refresh()
      }
    })
  }

  const regenerateTls = (): void => {
    void run(async () => {
      if (!api?.regenerateWebServerTls) {
        await alert('Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      const ok = await confirm(
        '현재 LAN IP를 넣어 서버 인증서를 다시 만듭니다. HTTPS가 켜져 있으면 서버를 재시작합니다.',
        { confirmLabel: '다시 만들기' }
      )
      if (!ok) return
      try {
        const result = await api.regenerateWebServerTls()
        setSync(result.sync)
        await alert(result.message)
      } catch (err) {
        await alert(err instanceof Error ? err.message : '인증서를 다시 만들지 못했습니다.')
        await refresh()
      }
    })
  }

  const exportCa = (): void => {
    void run(async () => {
      if (!api?.exportWebServerCa) {
        await alert('Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      try {
        const result = await api.exportWebServerCa()
        if (result.canceled) return
        setSync(result.sync)
        await alert(
          result.message ??
            (result.path
              ? `저장했습니다.\n${result.path}`
              : 'CA 인증서를 내보냈습니다.')
        )
      } catch (err) {
        await alert(err instanceof Error ? err.message : '내보내지 못했습니다.')
      }
    })
  }

  const revealTlsFolder = (): void => {
    void run(async () => {
      if (!api?.revealWebServerTlsFolder) {
        await alert('Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      try {
        await api.revealWebServerTlsFolder()
      } catch (err) {
        const folder = sync.tls.dir
        await alert(
          err instanceof Error
            ? err.message
            : folder
              ? `폴더를 열지 못했습니다.\n${folder}`
              : '폴더를 열지 못했습니다.'
        )
      }
    })
  }

  const allowFirewall = (): void => {
    void run(async () => {
      if (!api?.allowWebServerFirewall) {
        await alert('방화벽 설정은 Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      const port = await draftPortOrAlert()
      if (port == null) return
      try {
        await persistPort(port)
        const result = await api.allowWebServerFirewall(port)
        await alert(result.message)
      } catch (err) {
        await alert(err instanceof Error ? err.message : '방화벽 규칙을 추가하지 못했습니다.')
      }
    })
  }

  const removeFirewall = (): void => {
    void run(async () => {
      if (!api?.removeWebServerFirewall) {
        await alert('방화벽 설정은 Electron 앱에서만 사용할 수 있습니다.')
        return
      }
      const port = await draftPortOrAlert()
      if (port == null) return
      const ok = await confirm(
        `TCP ${port} 방화벽 인바운드 허용 규칙을 제거할까요?`,
        { variant: 'danger', confirmLabel: '제거' }
      )
      if (!ok) return
      try {
        const result = await api.removeWebServerFirewall(port)
        await alert(result.message)
      } catch (err) {
        await alert(err instanceof Error ? err.message : '방화벽 규칙을 제거하지 못했습니다.')
      }
    })
  }

  const runningLocal = sync.running && !sync.lanMode
  const runningLan = sync.running && sync.lanMode
  const displayPort = sync.port ?? sync.configuredPort
  const storedPort = normalizeWebServerPort(settings.webServerPort)

  return (
    <div className="w-full max-w-full text-left">
      <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">서버 관리</h2>

      <div className="space-y-4">
        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">포트</h3>
          <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
            HTTP(S) 웹 서버 TCP 포트입니다. 저장·서버 시작 시{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">settings.json</code>에 남으며,{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">.env</code>의{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">PORT</code>보다 항상 우선합니다.
            아직 저장하지 않았다면 .env(없으면 {DEFAULT_WEB_SERVER_PORT})를 사용합니다.
            {storedPort != null ? (
              <>
                {' '}
                현재 저장값: <code className="rounded bg-gcal-page px-1 text-[12px]">{storedPort}</code>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={65535}
              inputMode="numeric"
              className="w-32 rounded-md border border-gcal-border bg-gcal-input px-3 py-2 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
              value={portDraft}
              disabled={busy}
              onChange={(e) => setPortDraft(e.target.value)}
              aria-label="웹 서버 포트"
            />
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={savePort}
            >
              포트 저장
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">HTTP(S) 웹 서버</h3>
          <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
            Local / Web 시작 시 포트와 모드가 설정에 저장되어 다음 실행에도 유지됩니다 (.env
            HOSTNAME보다 우선). 트레이 Start Server도 동일하게 모드를 기억합니다. HTTPS는 아래
            항목에서 같은 포트에 적용됩니다.
          </p>

          <dl className="mb-4 grid gap-2 text-sm text-gcal-heading sm:grid-cols-[7rem_1fr]">
            <dt className="text-gcal-muted">상태</dt>
            <dd>{modeLabel(sync)}</dd>
            <dt className="text-gcal-muted">포트</dt>
            <dd>{displayPort}</dd>
            <dt className="text-gcal-muted">주소</dt>
            <dd className="break-all">
              {sync.addresses.length > 0 ? sync.addresses.join(', ') : '—'}
            </dd>
            {sync.editorUrl ? (
              <>
                <dt className="text-gcal-muted">편집 URL</dt>
                <dd className="break-all">{sync.editorUrl}</dd>
              </>
            ) : null}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy || runningLocal}
              onClick={() => startMode('local')}
            >
              {runningLocal ? '✓ Local 실행 중' : 'Webserver (Local)'}
            </button>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy || runningLan}
              onClick={() => startMode('lan')}
            >
              {runningLan ? '✓ Web 실행 중' : 'Webserver (Web)'}
            </button>
            <button
              type="button"
              className="settings-btn-danger rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy || !sync.running}
              onClick={stopServer}
            >
              서버 중지
            </button>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={() => void refresh()}
            >
              상태 새로고침
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">HTTPS</h3>
          <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
            같은 포트에서 TLS로 암호화합니다. 이 앱 창은 자체 인증서를 자동으로 신뢰합니다. 다른
            PC·휴대폰 브라우저는 아래 CA 인증서를 한 번 설치해야 경고가 사라집니다. LAN IP가 바뀌면
            서버 인증서를 다시 만드세요. 인증서는 데이터 폴더의{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">tls</code>에 저장됩니다.
          </p>
          <dl className="mb-4 grid gap-2 text-sm text-gcal-heading sm:grid-cols-[7rem_1fr]">
            <dt className="text-gcal-muted">상태</dt>
            <dd>{sync.httpsEnabled ? '켜짐' : '꺼짐'}</dd>
            <dt className="text-gcal-muted">SAN</dt>
            <dd className="break-all">
              {sync.tls.sans.length > 0 ? sync.tls.sans.join(', ') : '—'}
            </dd>
            <dt className="text-gcal-muted">만료</dt>
            <dd>
              {sync.tls.notAfter
                ? new Date(sync.tls.notAfter).toLocaleString('ko-KR')
                : '—'}
            </dd>
            <dt className="text-gcal-muted">폴더</dt>
            <dd className="break-all font-mono text-xs">{sync.tls.dir || '—'}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`${
                sync.httpsEnabled ? 'settings-btn-danger' : 'settings-btn-secondary'
              } rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60`}
              disabled={busy}
              onClick={toggleHttps}
            >
              {sync.httpsEnabled ? 'HTTPS 끄기' : 'HTTPS 켜기'}
            </button>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={regenerateTls}
            >
              인증서 다시 만들기
            </button>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={exportCa}
            >
              CA 인증서 내보내기
            </button>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={revealTlsFolder}
            >
              인증서 폴더 열기
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">방화벽 인바운드 허용</h3>
          <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
            Web(LAN) 모드에서 다른 PC가 접속하려면 Windows 방화벽에서 위 포트(입력란 기준)의 TCP
            인바운드를 허용해야 합니다. 권한이 없으면 UAC 확인이 뜹니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={allowFirewall}
            >
              방화벽 허용 규칙 추가
            </button>
            <button
              type="button"
              className="settings-btn-danger rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={busy}
              onClick={removeFirewall}
            >
              방화벽 허용 규칙 제거
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ServerManagementPanel
