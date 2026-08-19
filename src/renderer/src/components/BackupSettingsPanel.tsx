import { useCallback, useEffect, useState, type ReactElement } from 'react'
import {
  DEFAULT_STORE_BACKUP,
  formatByteSize,
  normalizeBackupTime,
  normalizeStoreBackup,
  STORE_BACKUP_FILE_PREFIX,
  type StoreBackupArchive,
  type StoreBackupRunResult,
  type StoreBackupSettings
} from '../../../shared/storeBackup'
import { isBrowserNeoCalendarHost } from '../lib/browserNeoCalendar'
import { useAppDialog } from './AppDialogProvider'

const btnSecondary =
  'settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60'
const btnDanger =
  'settings-btn-danger rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-60'

function splitArchiveName(name: string): { folder: string; base: string } {
  const raw = String(name ?? '')
  const slash = raw.lastIndexOf('/')
  if (slash < 0) return { folder: '', base: raw }
  return { folder: raw.slice(0, slash), base: raw.slice(slash + 1) }
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('ko-KR')
  } catch {
    return iso
  }
}

export function BackupSettingsPanel(): ReactElement {
  const { alert, confirm } = useAppDialog()
  const electron = !isBrowserNeoCalendarHost()
  const [config, setConfig] = useState<StoreBackupSettings>(DEFAULT_STORE_BACKUP)
  const [timeDraft, setTimeDraft] = useState('18:00')
  const [last, setLast] = useState<StoreBackupRunResult | null>(null)
  const [archives, setArchives] = useState<StoreBackupArchive[]>([])
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const status = await window.neoCalendar.getStoreBackupStatus()
      setConfig(normalizeStoreBackup(status?.config))
      setLast(status?.last ?? null)
      setArchives(Array.isArray(status?.archives) ? status.archives : [])
      setRunning(Boolean(status?.running))
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '백업 설정을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const persist = async (patch: Partial<StoreBackupSettings>): Promise<boolean> => {
    setBusy(true)
    try {
      const next = await window.neoCalendar.saveStoreBackupConfig({ ...config, ...patch })
      setConfig(normalizeStoreBackup(next))
      return true
    } catch (error) {
      await alert(error instanceof Error ? error.message : '백업 설정을 저장하지 못했습니다.', {
        title: '백업 관리'
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  const chooseDest = async (): Promise<void> => {
    if (!electron) return
    const picked = await window.neoCalendar.pickStoreBackupDest()
    if (!picked) return
    if (await persist({ destPath: picked })) await refresh()
  }

  const addTime = async (): Promise<void> => {
    const time = normalizeBackupTime(timeDraft)
    if (!time) {
      await alert('시간 형식이 올바르지 않습니다. 예: 09:00', { title: '백업 관리' })
      return
    }
    if (config.times.includes(time)) return
    await persist({ times: [...config.times, time] })
  }

  const removeTime = async (time: string): Promise<void> => {
    await persist({ times: config.times.filter((item) => item !== time) })
  }

  const deleteArchive = async (fileName: string): Promise<void> => {
    const ok = await confirm(`"${fileName}" 파일을 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다.`, {
      title: '백업 삭제',
      variant: 'danger',
      confirmLabel: '삭제'
    })
    if (!ok) return
    setBusy(true)
    try {
      const next = await window.neoCalendar.deleteStoreBackup(fileName)
      setArchives(Array.isArray(next) ? next : [])
      if (last?.fileName === fileName) setLast(null)
    } catch (error) {
      await alert(error instanceof Error ? error.message : '백업을 삭제하지 못했습니다.', {
        title: '백업 삭제 실패'
      })
    } finally {
      setBusy(false)
    }
  }

  const runNow = async (): Promise<void> => {
    if (!config.destPath) {
      await alert('백업 폴더를 먼저 지정해 주세요.', { title: '백업 관리' })
      return
    }
    setBusy(true)
    setRunning(true)
    try {
      const result = await window.neoCalendar.runStoreBackupNow()
      setLast(result)
      await refresh()
      const extra =
        typeof result.attachmentFiles === 'number'
          ? `\n첨부 ${result.attachmentFiles}개`
          : ''
      await alert(
        `백업을 만들었습니다.\n${result.fileName}\n${formatByteSize(result.bytes)}${extra}`,
        { title: '백업 관리' }
      )
    } catch (error) {
      await alert(error instanceof Error ? error.message : '백업을 만들지 못했습니다.', {
        title: '백업 실패'
      })
      await refresh()
    } finally {
      setBusy(false)
      setRunning(false)
    }
  }

  return (
    <div className="w-full max-w-full space-y-8 text-left">
      <h2 className="text-[22px] font-normal text-gcal-heading">백업 관리</h2>

      {loadError ? (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{loadError}</p>
          <button type="button" className={btnSecondary} onClick={() => void refresh()}>
            다시 시도
          </button>
        </div>
      ) : null}

      <section className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
        <h3 className="mb-2 text-base font-medium text-gcal-heading">백업 대상</h3>
        <p className="text-sm leading-relaxed text-gcal-muted">
          일정 데이터와 첨부 파일을 ZIP 하나로 저장합니다. 가져오기/내보내기의 저장 대화상자와
          같은 내용이며, 여기에서는 지정한 폴더에 날짜별 폴더로 쌓입니다.
        </p>
      </section>

      <section className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
        <h3 className="mb-2 text-base font-medium text-gcal-heading">백업 폴더</h3>
        <p className="mb-3 text-sm leading-relaxed text-gcal-muted">
          일정 데이터 폴더 밖이면 됩니다. 다른 드라이브나 외장 디스크를 지정할 수 있습니다.
        </p>
        <p className="mb-3 break-all rounded-lg border border-gcal-border bg-gcal-page px-3 py-2 font-mono text-xs text-gcal-heading">
          {config.destPath || '아직 지정하지 않았습니다.'}
        </p>
        {!electron ? (
          <p className="rounded-lg border border-dashed border-gcal-border px-3 py-2 text-sm text-gcal-muted">
            백업 폴더는 이 PC의 Neo Desktop Calendar 앱에서만 지정할 수 있습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => void chooseDest()}>
              폴더 선택…
            </button>
            <button
              type="button"
              className={btnSecondary}
              disabled={busy || !config.destPath}
              onClick={() => void persist({ destPath: null })}
            >
              지정 해제
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
        <h3 className="mb-2 text-base font-medium text-gcal-heading">지금 백업</h3>
        <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
          백업 폴더 아래 <code className="rounded bg-gcal-page px-1 text-[12px]">YYYYMMDD</code>{' '}
          폴더를 만들고 그 안에{' '}
          <code className="rounded bg-gcal-page px-1 text-[12px]">
            {STORE_BACKUP_FILE_PREFIX}YYMMDD_HHMMSS.zip
          </code>
          을 넣습니다. 같은 날 백업 횟수가 하루 한도를 넘으면 그 폴더에서 오래된 회차부터 지웁니다.
        </p>
        <button
          type="button"
          className={btnSecondary}
          disabled={busy || running || !electron || !config.destPath}
          onClick={() => void runNow()}
        >
          {running ? '백업 중…' : '지금 백업'}
        </button>
      </section>

      <section className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
        <h3 className="mb-2 text-base font-medium text-gcal-heading">자동 미러</h3>
        <label className="mb-3 flex items-center gap-2 text-sm text-gcal-heading">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gcal-border"
            checked={config.enabled}
            disabled={busy || !electron}
            onChange={(event) => void persist({ enabled: event.target.checked })}
          />
          지정한 시각에 자동으로 백업
        </label>
        <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
          앱이 켜져 있는 동안만 동작합니다. 해당 시각에 꺼져 있었다면 그날 그 시각이 지난 뒤 처음
          켜질 때 한 번 실행합니다.
        </p>

        <label className="mb-4 block max-w-xs space-y-1">
          <span className="text-xs font-medium text-gcal-muted">하루에 남길 백업 횟수</span>
          <input
            type="number"
            min={1}
            max={24}
            className="w-full rounded-md border border-gcal-border bg-gcal-input px-3 py-2 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
            value={config.maxPerDay}
            disabled={busy || !electron}
            onChange={(event) => {
              const value = Number(event.target.value)
              setConfig((prev) => ({ ...prev, maxPerDay: value }))
            }}
            onBlur={(event) => void persist({ maxPerDay: Number(event.target.value) })}
          />
        </label>

        <div className="space-y-2">
          <span className="text-xs font-medium text-gcal-muted">백업 시각</span>
          {config.times.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gcal-border px-3 py-2 text-sm text-gcal-muted">
              등록된 시각이 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {config.times.map((time) => (
                <li
                  key={time}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gcal-border bg-gcal-page px-3 py-2"
                >
                  <span className="font-mono text-sm font-semibold text-gcal-heading">{time}</span>
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy || !electron}
                    onClick={() => void removeTime(time)}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1">
            <span className="text-xs font-medium text-gcal-muted">시각 추가</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                className="h-10 rounded-md border border-gcal-border bg-gcal-input px-3 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
                value={timeDraft}
                onChange={(event) => setTimeDraft(event.target.value)}
              />
              <button
                type="button"
                className={`${btnSecondary} h-10`}
                disabled={busy || !electron}
                onClick={() => void addTime()}
              >
                시각 추가
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
        <h3 className="mb-2 text-base font-medium text-gcal-heading">최근 백업</h3>
        {last?.error ? <p className="mb-2 text-sm text-red-600">{last.error}</p> : null}
        {archives.length === 0 ? (
          <p className="text-sm text-gcal-muted">아직 백업 파일이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {archives.map((item) => {
              const { folder, base } = splitArchiveName(item.fileName)
              return (
                <li
                  key={item.fileName}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gcal-border bg-gcal-page px-3 py-2"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate font-mono text-sm font-semibold text-gcal-heading"
                      title={item.fileName}
                    >
                      {base}
                    </p>
                    <p className="text-xs text-gcal-muted">
                      {folder ? `${folder} · ` : ''}
                      {formatWhen(item.at)}
                      {typeof item.bytes === 'number' ? ` · ${formatByteSize(item.bytes)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy || running || !electron}
                    onClick={() => void deleteArchive(item.fileName)}
                  >
                    삭제
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
