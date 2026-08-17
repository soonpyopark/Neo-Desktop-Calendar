import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  defaultMemberPassword,
  isBootstrapAdminMember,
  memberRoleToLabel,
  normalizeMemberRole
} from '../../../shared/members'
import type {
  MemberRecord,
  MemberRole,
  MemberSaveInput,
  StoreSettings
} from '../../../shared/calendarTypes'
import { cn } from '../lib/cn'
import { useAppDialog } from './AppDialogProvider'

type MemberDraft = MemberRecord & {
  password?: string
  isNew?: boolean
  markedDelete?: boolean
}

type MembersSubTab = 'member-list' | 'member-add'

const fieldClass =
  'w-full rounded-lg border border-gcal-border bg-gcal-input px-3 py-2 text-sm text-gcal-heading outline-none focus:border-gcal-blue focus:ring-2 focus:ring-gcal-blue/15'

function createMemberDraft(member: MemberRecord): MemberDraft {
  return { ...member, password: '', isNew: false, markedDelete: false }
}

function matchesMemberSearch(member: MemberDraft, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    member.displayName.toLowerCase().includes(normalized) ||
    member.loginId.toLowerCase().includes(normalized)
  )
}

function buildPayloadFromDraft(draftMembers: MemberDraft[]): MemberSaveInput[] {
  const memberPayload: MemberSaveInput[] = []
  for (const member of draftMembers) {
    if (member.markedDelete && !member.isNew) {
      memberPayload.push({
        id: member.id,
        loginId: member.loginId,
        displayName: member.displayName,
        role: member.role,
        active: member.active,
        _delete: true
      })
      continue
    }
    if (member.markedDelete) continue
    if (member.isNew) {
      memberPayload.push({
        loginId: member.loginId,
        displayName: member.displayName,
        role: member.role,
        active: member.active,
        password: member.password
      })
    } else {
      memberPayload.push({
        id: member.id,
        loginId: member.loginId,
        displayName: member.displayName,
        role: member.role,
        active: member.active,
        ...(member.password ? { password: member.password } : {})
      })
    }
  }
  return memberPayload
}

export type MembersPanelProps = {
  listMembers: () => Promise<MemberRecord[]>
  saveMembers: (members: MemberSaveInput[]) => Promise<MemberRecord[]>
  settings: StoreSettings
  onSaveSettings: (patch: Partial<StoreSettings>) => Promise<void>
}

export function MembersPanel({
  listMembers,
  saveMembers,
  settings,
  onSaveSettings
}: MembersPanelProps): ReactElement {
  const { alert, confirm } = useAppDialog()
  const [tab, setTab] = useState<MembersSubTab>('member-list')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [members, setMembers] = useState<MemberDraft[]>([])
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [memberLoginId, setMemberLoginId] = useState('')
  const [memberRole, setMemberRole] = useState<MemberRole>('member')
  const [memberActive, setMemberActive] = useState(true)
  const [memberPassword, setMemberPassword] = useState('')
  const [memberSearchQuery, setMemberSearchQuery] = useState('')

  const applyMembers = useCallback((nextMembers: MemberRecord[]) => {
    setMembers((Array.isArray(nextMembers) ? nextMembers : []).map(createMemberDraft))
  }, [])

  const loadMembers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listMembers()
      applyMembers(result ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '회원 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [applyMembers, listMembers])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const visibleMembers = members.filter((member) => !member.markedDelete)
  const filteredMembers = useMemo(
    () => visibleMembers.filter((member) => matchesMemberSearch(member, memberSearchQuery)),
    [visibleMembers, memberSearchQuery]
  )

  const resetMemberForm = (): void => {
    setEditingMemberId(null)
    setMemberLoginId('')
    setMemberRole('member')
    setMemberActive(true)
    setMemberPassword('')
  }

  const openMemberAddTab = (): void => {
    resetMemberForm()
    setTab('member-add')
  }

  const startEditMember = (member: MemberDraft): void => {
    setEditingMemberId(member.id)
    setMemberLoginId(member.loginId)
    setMemberRole(normalizeMemberRole(member.role))
    setMemberActive(member.active)
    setMemberPassword('')
    setTab('member-add')
  }

  const persistMembers = async (
    draftMembers: MemberDraft[],
    { silent = false }: { silent?: boolean } = {}
  ): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      const next = await saveMembers(buildPayloadFromDraft(draftMembers))
      applyMembers(next)
      if (!silent) {
        await alert('회원 설정을 저장했습니다.', { title: '회원 관리' })
      }
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : '회원 저장에 실패했습니다.'
      setError(message)
      setMembers(draftMembers)
      await alert(message, { title: '회원 관리' })
      return false
    } finally {
      setSaving(false)
    }
  }

  const editingMember = editingMemberId
    ? (members.find((member) => member.id === editingMemberId) ?? null)
    : null
  const editingBootstrapAdmin = isBootstrapAdminMember(editingMember)

  const handleMemberSubmit = async (): Promise<void> => {
    const loginId = (
      editingBootstrapAdmin ? (editingMember?.loginId ?? memberLoginId) : memberLoginId
    ).trim()
    if (!loginId) {
      await alert('로그인 아이디를 입력해 주세요.', { title: '회원 관리' })
      return
    }
    if (!editingMemberId && memberPassword.trim().length < 6) {
      await alert('비밀번호는 6자 이상이어야 합니다.', { title: '회원 관리' })
      return
    }
    if (editingMemberId && memberPassword.trim() && memberPassword.trim().length < 6) {
      await alert('비밀번호는 6자 이상이어야 합니다.', { title: '회원 관리' })
      return
    }

    const duplicate = members.some(
      (member) =>
        !member.markedDelete &&
        member.id !== editingMemberId &&
        member.loginId.toLowerCase() === loginId.toLowerCase()
    )
    if (duplicate) {
      await alert(`아이디 「${loginId}」가 이미 사용 중입니다.`, { title: '회원 관리' })
      return
    }

    let nextMembers: MemberDraft[]
    if (editingMemberId) {
      nextMembers = members.map((member) =>
        member.id === editingMemberId
          ? {
              ...member,
              loginId: editingBootstrapAdmin ? member.loginId : loginId,
              displayName: editingBootstrapAdmin ? member.displayName || member.loginId : loginId,
              role: editingBootstrapAdmin ? 'super_admin' : memberRole,
              active: editingBootstrapAdmin ? true : memberActive,
              password: memberPassword
            }
          : member
      )
    } else {
      nextMembers = [
        ...members,
        {
          id: `new-member-${Date.now()}`,
          loginId,
          displayName: loginId,
          role: memberRole,
          active: memberActive,
          password: memberPassword,
          isNew: true
        }
      ]
    }

    setMembers(nextMembers)
    resetMemberForm()
    setTab('member-list')
    await persistMembers(nextMembers, { silent: true })
  }

  const markMemberDelete = async (member: MemberDraft): Promise<void> => {
    if (isBootstrapAdminMember(member)) {
      await alert('기본 관리자(admin) 계정은 삭제할 수 없습니다.', { title: '회원 관리' })
      return
    }
    const ok = await confirm(
      `「${member.loginId}」 회원과 해당 회원의 캘린더·일정이 모두 삭제됩니다.`,
      {
        title: '회원 삭제',
        confirmLabel: '삭제',
        variant: 'danger'
      }
    )
    if (!ok) return

    const nextMembers: MemberDraft[] = member.isNew
      ? members.filter((entry) => entry.id !== member.id)
      : members.map((entry) =>
          entry.id === member.id ? { ...entry, markedDelete: true } : entry
        )

    if (editingMemberId === member.id) resetMemberForm()
    setMembers(nextMembers)
    await persistMembers(nextMembers, { silent: true })
  }

  const persistLoginLockout = async (enabled: boolean): Promise<void> => {
    try {
      await onSaveSettings({ loginLockoutEnabled: enabled })
    } catch (err) {
      await alert(
        err instanceof Error ? err.message : '로그인 제한 설정을 저장하지 못했습니다.',
        { title: '회원 관리' }
      )
    }
  }

  return (
    <div className="w-full max-w-full text-left">
      <h2 className="mb-2 text-[22px] font-normal text-gcal-heading">회원 관리</h2>
      <p className="mb-6 text-sm text-gcal-muted">
        로그인할 수 있는 계정을 추가·수정합니다. 기본 관리자(admin)는 목록에 포함되며, 여기서 바꾼
        비밀번호가 .env 설정보다 우선합니다.
      </p>

      <section className="mb-6 rounded-lg border border-gcal-border bg-gcal-surface px-4 py-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gcal-heading">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gcal-border accent-gcal-blue"
            checked={settings.loginLockoutEnabled === true}
            disabled={loading || saving}
            onChange={(event) => void persistLoginLockout(event.target.checked)}
          />
          로그인 3회 실패 시 5분간 제한
        </label>
        <p className="mt-1 pl-6 text-xs text-gcal-muted">
          같은 아이디로 비밀번호를 3번 틀리면 5분간 로그인을 막습니다. 이 PC(127.0.0.1)는
          제한되지 않습니다.
        </p>
      </section>

      <div
        className="mb-4 flex gap-1 border-b border-gcal-border-light"
        role="tablist"
        aria-label="회원 관리"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'member-list'}
          className={cn(
            '-mb-px rounded-t-lg px-3 py-2 text-sm',
            tab === 'member-list'
              ? 'border border-b-transparent border-gcal-border-light bg-gcal-surface font-medium text-gcal-heading'
              : 'border border-transparent font-medium text-gcal-muted hover:text-gcal-heading'
          )}
          onClick={() => setTab('member-list')}
        >
          회원목록
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'member-add'}
          className={cn(
            '-mb-px rounded-t-lg px-3 py-2 text-sm',
            tab === 'member-add'
              ? 'border border-b-transparent border-gcal-border-light bg-gcal-surface font-medium text-gcal-heading'
              : 'border border-transparent font-medium text-gcal-muted hover:text-gcal-heading'
          )}
          onClick={openMemberAddTab}
        >
          회원추가
        </button>
      </div>

      {loading ? <p className="text-sm text-gcal-muted">회원 목록을 불러오는 중…</p> : null}
      {error ? <p className="text-sm text-[#c5221f]">{error}</p> : null}
      {saving ? <p className="text-sm text-gcal-muted">저장 중…</p> : null}

      {!loading && tab === 'member-list' ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-gcal-heading">회원 목록</h3>
              <p className="text-xs text-gcal-muted">
                총 {visibleMembers.length}명
                {memberSearchQuery.trim() ? ` · 검색 결과 ${filteredMembers.length}명` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="search"
                className="h-8 w-52 rounded-lg border border-gcal-border bg-gcal-input px-2 text-sm text-gcal-heading outline-none focus:border-gcal-blue"
                value={memberSearchQuery}
                onChange={(event) => setMemberSearchQuery(event.target.value)}
                placeholder="회원 이름·아이디 검색"
                aria-label="회원 검색"
              />
              {memberSearchQuery ? (
                <button
                  type="button"
                  className="settings-btn-secondary h-8 rounded-lg px-2 text-xs"
                  onClick={() => setMemberSearchQuery('')}
                >
                  검색 초기화
                </button>
              ) : null}
            </div>
          </div>

          {filteredMembers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gcal-border px-3 py-4 text-sm text-gcal-muted">
              표시할 회원이 없습니다.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-gcal-border-light overflow-hidden rounded-lg border border-gcal-border-light p-0">
              {filteredMembers.map((member) => {
                const bootstrapAdmin = isBootstrapAdminMember(member)
                return (
                  <li
                    key={member.id}
                    className={cn(
                      'flex items-center justify-between gap-3 px-3 py-2.5',
                      editingMemberId === member.id ? 'bg-gcal-blue-soft/50' : 'bg-gcal-surface'
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gcal-heading">
                        {member.displayName}
                        {bootstrapAdmin ? (
                          <span className="ml-1.5 text-xs font-normal text-gcal-muted">
                            (기본 관리자)
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-gcal-muted">
                        {member.loginId}
                        {' · '}
                        {memberRoleToLabel(member.role)}
                        {!member.active ? ' · 비활성' : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        className="settings-btn-secondary rounded-lg px-2 py-1 text-xs"
                        disabled={saving}
                        onClick={() => startEditMember(member)}
                      >
                        수정
                      </button>
                      {bootstrapAdmin ? null : (
                        <button
                          type="button"
                          className="settings-btn-danger rounded-lg px-2 py-1 text-xs"
                          disabled={saving}
                          onClick={() => void markMemberDelete(member)}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : null}

      {!loading && tab === 'member-add' ? (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-gcal-heading">
            {editingMemberId
              ? editingBootstrapAdmin
                ? '기본 관리자 수정'
                : '회원 수정'
              : '회원 추가'}
          </h3>
          <p className="text-xs text-gcal-muted">
            {editingBootstrapAdmin
              ? '기본 관리자 비밀번호를 변경할 수 있습니다. 변경한 비밀번호가 .env 설정보다 우선합니다.'
              : editingMemberId
                ? '회원 정보를 수정합니다. 비밀번호는 변경할 때만 입력하세요.'
                : '새 회원을 추가합니다. 표시 이름은 로그인 아이디와 동일하게 등록됩니다.'}
          </p>
          <div className="space-y-3 rounded-xl border border-gcal-border-light bg-gcal-surface p-4">
            <label className="block space-y-1">
              <span className="text-xs text-gcal-muted">로그인 아이디</span>
              <input
                type="text"
                className={fieldClass}
                value={memberLoginId}
                onChange={(event) => setMemberLoginId(event.target.value)}
                placeholder="로그인 아이디"
                autoComplete="off"
                disabled={editingBootstrapAdmin}
              />
            </label>
            {editingBootstrapAdmin ? null : (
              <>
                <label className="block space-y-1">
                  <span className="text-xs text-gcal-muted">역할</span>
                  <select
                    className={fieldClass}
                    value={memberRole === 'member' ? 'member' : 'super_admin'}
                    onChange={(event) =>
                      setMemberRole(
                        event.target.value === 'member' ? 'member' : 'super_admin'
                      )
                    }
                  >
                    <option value="member">일반사용자</option>
                    <option value="super_admin">총괄관리자</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gcal-body">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gcal-border"
                    checked={memberActive}
                    onChange={(event) => setMemberActive(event.target.checked)}
                  />
                  활성 계정
                </label>
              </>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[12rem] flex-1 space-y-1">
                <span className="text-xs text-gcal-muted">비밀번호</span>
                <input
                  type="text"
                  className={fieldClass}
                  value={memberPassword}
                  onChange={(event) => setMemberPassword(event.target.value)}
                  placeholder={
                    editingMemberId ? '비밀번호 (변경 시에만 입력)' : '비밀번호 (6자 이상)'
                  }
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="settings-btn-secondary h-[38px] rounded-lg px-3 text-sm"
                onClick={() => setMemberPassword(defaultMemberPassword(memberLoginId))}
              >
                초기 비밀번호 설정
              </button>
            </div>
            <div className="flex justify-end gap-2">
              {editingMemberId ? (
                <button
                  type="button"
                  className="settings-btn-secondary rounded-lg px-3 py-1.5 text-sm"
                  disabled={saving}
                  onClick={() => {
                    resetMemberForm()
                    setTab('member-list')
                  }}
                >
                  취소
                </button>
              ) : null}
              <button
                type="button"
                className="settings-btn-primary rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                disabled={saving}
                onClick={() => void handleMemberSubmit()}
              >
                {saving ? '저장 중…' : editingMemberId ? '적용' : '회원 추가'}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export default MembersPanel
