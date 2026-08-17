import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  isValidIpOrCidr,
  normalizeAllowedIpCidrs,
  type AllowedIpEntry
} from '../../../shared/ipCidrCore'
import {
  buildSecuritySettingsPayload,
  parseSecuritySettingsPayload,
  securitySettingsExportFilename
} from '../../../shared/securitySettingsIo'
import { downloadCalendarFile } from '../../../shared/calendarInterchange'
import type { StoreSettings } from '../../../shared/calendarTypes'
import { useAppDialog } from './AppDialogProvider'

export type SecurityPanelProps = {
  settings: StoreSettings
  onSaveSettings: (patch: Partial<StoreSettings>) => Promise<void>
}

export function SecurityPanel({ settings, onSaveSettings }: SecurityPanelProps): ReactElement {
  const { alert, confirm } = useAppDialog()
  const [importing, setImporting] = useState(false)
  const [allowedIpCidrs, setAllowedIpCidrs] = useState<AllowedIpEntry[]>(() =>
    normalizeAllowedIpCidrs(settings?.allowedIpCidrs ?? [])
  )
  const [ipCidrDraft, setIpCidrDraft] = useState('')
  const [ipDescriptionDraft, setIpDescriptionDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const descriptionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setAllowedIpCidrs(normalizeAllowedIpCidrs(settings?.allowedIpCidrs ?? []))
  }, [settings?.allowedIpCidrs])

  useEffect(
    () => () => {
      if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current)
    },
    []
  )

  const persistList = async (
    nextList: AllowedIpEntry[],
    { silent = true }: { silent?: boolean } = {}
  ): Promise<boolean> => {
    setSaving(true)
    try {
      const normalized = normalizeAllowedIpCidrs(nextList)
      await onSaveSettings({ allowedIpCidrs: normalized })
      setAllowedIpCidrs(normalized)
      if (!silent) {
        await alert('허용 IP 목록을 저장했습니다.')
      }
      return true
    } catch (err) {
      await alert(err instanceof Error ? err.message : '허용 IP를 저장하지 못했습니다.')
      return false
    } finally {
      setSaving(false)
    }
  }

  const addAllowedIp = async (): Promise<void> => {
    const value = ipCidrDraft.trim()
    if (!value) {
      await alert('허용 IP 주소를 입력해 주세요.')
      return
    }
    if (!isValidIpOrCidr(value)) {
      await alert(
        '올바른 IPv4 주소, CIDR, 또는 IP 범위 형식이 아닙니다.\n예: 192.168.0.0/24, 10.0.0.30, 221.168.1.0-221.168.12.255'
      )
      return
    }
    const key = value.toLowerCase()
    if (allowedIpCidrs.some((item) => item.cidr.toLowerCase() === key)) {
      await alert('이미 등록된 IP/CIDR/범위 입니다.')
      return
    }
    const description = ipDescriptionDraft.trim()
    const nextList = [
      ...allowedIpCidrs,
      description ? { cidr: value, description } : { cidr: value }
    ]
    setIpCidrDraft('')
    setIpDescriptionDraft('')
    await persistList(nextList)
  }

  const removeAllowedIp = async (cidr: string): Promise<void> => {
    await persistList(allowedIpCidrs.filter((item) => item.cidr !== cidr))
  }

  const updateAllowedIpDescription = (cidr: string, description: string): void => {
    const trimmed = description.trim()
    const nextList = allowedIpCidrs.map((item) => {
      if (item.cidr !== cidr) return item
      if (!trimmed) return { cidr: item.cidr }
      return { cidr: item.cidr, description: trimmed }
    })
    setAllowedIpCidrs(nextList)
    if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current)
    descriptionSaveTimerRef.current = setTimeout(() => {
      void persistList(nextList)
    }, 400)
  }

  const handleExportSecurity = async (): Promise<void> => {
    try {
      const payload = buildSecuritySettingsPayload(allowedIpCidrs)
      const content = `${JSON.stringify(payload, null, 2)}\n`
      downloadCalendarFile(content, securitySettingsExportFilename(), 'application/json')
      await alert(
        allowedIpCidrs.length === 0
          ? '허용 IP가 비어 있는 보안설정을 내보냈습니다.'
          : `허용 IP ${allowedIpCidrs.length}건을 포함한 보안설정을 내보냈습니다.`,
        { title: '보안설정 내보내기' }
      )
    } catch (err) {
      await alert(err instanceof Error ? err.message : '보안설정을 내보내지 못했습니다.')
    }
  }

  const handleImportSecurity = async (): Promise<void> => {
    if (importing || saving) return

    setImporting(true)
    try {
      const picked = await window.neoCalendar.pickCalendarImportFile()
      if (picked.cancelled) return
      if (picked.kind !== 'text') {
        throw new Error('보안설정은 JSON 파일로만 가져올 수 있습니다.')
      }

      const { allowedIpCidrs: nextList } = parseSecuritySettingsPayload(picked.content)
      const ok = await confirm(
        nextList.length === 0
          ? `「${picked.filename}」의 허용 IP가 비어 있습니다.\n현재 목록을 모두 지울까요?`
          : `「${picked.filename}」에서 허용 IP ${nextList.length}건을 가져옵니다.\n현재 목록을 이 내용으로 바꿀까요?`,
        {
          title: '보안설정 가져오기',
          confirmLabel: '가져오기'
        }
      )
      if (!ok) return

      const saved = await persistList(nextList, { silent: true })
      if (saved) {
        await alert(
          nextList.length === 0
            ? '허용 IP 목록을 비웠습니다.'
            : `허용 IP ${nextList.length}건을 가져왔습니다.`,
          { title: '보안설정 가져오기' }
        )
      }
    } catch (err) {
      await alert(err instanceof Error ? err.message : '보안설정을 가져오지 못했습니다.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="w-full max-w-full text-left">
      <h2 className="mb-8 text-[22px] font-normal text-gcal-heading">보안 관리</h2>
      <div className="space-y-4">
        <div className="rounded-lg border border-gcal-border bg-gcal-surface p-5">
          <h3 className="mb-2 text-base font-medium text-gcal-heading">접속 허용 IP</h3>
          <p className="mb-4 text-sm leading-relaxed text-gcal-muted">
            웹(HTTP)으로 다른 PC에서 접속할 때 사용합니다. 목록이 비어 있으면 모든 IP에서 접속할 수
            있습니다. 항목을 추가하면 등록된 주소·대역·범위에서만 접속할 수 있습니다. 단일 IP, CIDR(
            <code className="rounded bg-gcal-page px-1 text-[12px]">192.168.0.0/24</code>
            ), 범위(
            <code className="rounded bg-gcal-page px-1 text-[12px]">221.168.1.0-221.168.12.255</code>
            ) 형식을 지원합니다. 서버 PC의{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">127.0.0.1</code> 은 항상
            허용됩니다. Tailscale 기기는 서버 IP가 아니라 각 기기의 주소로 들어오므로 대역{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">100.64.0.0/10</code> 을
            등록하세요. 설치 폴더
            <code className="rounded bg-gcal-page px-1 text-[12px]">.env</code>의{' '}
            <code className="rounded bg-gcal-page px-1 text-[12px]">HOSTNAME=0.0.0.0</code>과 URL
            ACL·방화벽도 함께 필요합니다. 목록이 비어 있으면 모든 IP가 허용되고, 항목이 있으면
            등록된 주소에서만 HTTP 접속할 수 있습니다.
          </p>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={saving}
              onClick={() => void handleExportSecurity()}
            >
              보안설정 내보내기
            </button>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
              disabled={saving || importing}
              onClick={() => void handleImportSecurity()}
            >
              {importing ? '가져오는 중…' : '보안설정 가져오기'}
            </button>
          </div>

          <ul className="mb-4 space-y-3">
            {allowedIpCidrs.length === 0 ? (
              <li className="list-none rounded-lg border border-dashed border-gcal-border px-3 py-3 text-sm text-gcal-muted">
                등록된 허용 IP가 없습니다.
              </li>
            ) : (
              allowedIpCidrs.map((entry) => (
                <li
                  key={entry.cidr}
                  className="list-none rounded-lg border border-gcal-border bg-gcal-page px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 break-all font-mono text-sm font-semibold text-gcal-heading">
                      {entry.cidr}
                    </span>
                    <button
                      type="button"
                      className="settings-btn-danger shrink-0 rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50"
                      disabled={saving}
                      onClick={() => void removeAllowedIp(entry.cidr)}
                    >
                      삭제
                    </button>
                  </div>
                  <label className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-gcal-muted">설명</span>
                    <input
                      type="text"
                      className="min-w-0 flex-1 border-0 border-b border-gcal-border bg-transparent px-0 py-1 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
                      placeholder="예: 본사 사내망, VPN 대역"
                      value={entry.description ?? ''}
                      onChange={(event) =>
                        updateAllowedIpDescription(entry.cidr, event.target.value)
                      }
                    />
                  </label>
                </li>
              ))
            )}
          </ul>

          <div className="space-y-3 rounded-lg border border-gcal-border bg-gcal-page p-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gcal-muted">허용 IP 주소</span>
              <input
                type="text"
                className="w-full rounded-md border border-gcal-border bg-gcal-input px-3 py-2 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
                placeholder="예: 192.168.0.0/24, 10.0.0.30, 221.168.1.0-221.168.12.255"
                value={ipCidrDraft}
                onChange={(event) => setIpCidrDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void addAllowedIp()
                  }
                }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gcal-muted">설명 (선택)</span>
              <input
                type="text"
                className="w-full rounded-md border border-gcal-border bg-gcal-input px-3 py-2 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
                placeholder="예: 본사 사내망, VPN 대역"
                value={ipDescriptionDraft}
                onChange={(event) => setIpDescriptionDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void addAllowedIp()
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="settings-btn-secondary rounded-full px-5 py-2 text-sm font-medium disabled:opacity-60"
              disabled={saving}
              onClick={() => void addAllowedIp()}
            >
              {saving ? '저장 중…' : 'IP 추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
