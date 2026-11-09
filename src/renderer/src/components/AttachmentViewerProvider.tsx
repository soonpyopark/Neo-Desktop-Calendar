import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import type { AttachmentImageEntry } from '../../../shared/ipc'
import { cn } from '../lib/cn'
import { openEventAttachment, readEventAttachmentImage } from '../lib/eventAttachments'
import { openAttachmentViewerPanel } from '../lib/openAttachmentViewerPanel'
import { useAppDialog } from './AppDialogProvider'
import { useImageActionMenu } from './ImageActionMenu'
import { InteractionUI } from './InteractionUI'

export type AttachmentViewerState = {
  eventId: string
  attachmentId: string
  name: string
  dataUrl: string
  images: AttachmentImageEntry[]
}

type AttachmentViewerApi = {
  /** Images open in the viewer; anything else is handed to the OS (browser: download). */
  openAttachment: (eventId: string, attachmentId: string) => Promise<void>
}

const AttachmentViewerContext = createContext<AttachmentViewerApi | null>(null)

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
/** `null` = fit to the surface; a number is a multiplier of the image's natural size. */
type Zoom = number | null

export type AttachmentImageViewerProps = {
  state: AttachmentViewerState
  onClose: () => void
  onSelect: (attachmentId: string) => void
  onOpenExternal: () => void
  /**
   * `floating` — fills its BrowserWindow (search/settings-sized panel).
   * `inline` — centered overlay at ~90%×80% (browser / no-panel fallback).
   */
  surface?: 'inline' | 'floating'
}

export function AttachmentImageViewer({
  state,
  onClose,
  onSelect,
  onOpenExternal,
  surface = 'inline'
}: AttachmentImageViewerProps): ReactElement {
  const isFloating = surface === 'floating'
  const [zoom, setZoom] = useState<Zoom>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const { openMenu, copyCurrent, Menu: imageMenu } = useImageActionMenu()

  const index = state.images.findIndex((item) => item.id === state.attachmentId)
  const total = state.images.length
  const canPage = total > 1

  const step = useCallback(
    (direction: 1 | -1) => {
      const canvas = canvasRef.current
      const fitRatio =
        natural && canvas
          ? Math.min(
              1,
              canvas.clientWidth / natural.width,
              canvas.clientHeight / natural.height
            )
          : 1
      const current = zoom ?? fitRatio
      const next =
        direction > 0
          ? ZOOM_STEPS.find((value) => value > current + 0.001)
          : [...ZOOM_STEPS].reverse().find((value) => value < current - 0.001)
      if (next === undefined) return
      setZoom(next)
    },
    [natural, zoom]
  )

  const page = useCallback(
    (direction: 1 | -1) => {
      if (!canPage || index < 0) return
      const next = (index + direction + total) % total
      setZoom(null)
      setNatural(null)
      onSelect(state.images[next].id)
    },
    [canPage, index, onSelect, state.images, total]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (event.key === 'Escape') {
        handled()
        onClose()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        // Don't steal copy when the user selected text in the title.
        const sel = window.getSelection()?.toString()
        if (sel) return
        handled()
        void copyCurrent({ dataUrl: state.dataUrl, filename: state.name })
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        handled()
        page(1)
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        handled()
        page(-1)
        return
      }
      if (event.key === '+' || event.key === '=') {
        handled()
        step(1)
        return
      }
      if (event.key === '-' || event.key === '_') {
        handled()
        step(-1)
        return
      }
      if (event.key === '0') {
        handled()
        setZoom(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [copyCurrent, onClose, page, state.dataUrl, state.name, step])

  const zoomLabel = zoom !== null ? `${Math.round(zoom * 100)}%` : '화면 맞춤'

  const shell = (
    <div
      className={cn(
        'attachment-viewer-shell shell-solid-surface relative flex min-h-0 flex-col overflow-hidden rounded-xl',
        isFloating ? 'h-full w-full flex-1' : 'h-full w-full max-h-full max-w-full'
      )}
      onClick={isFloating ? undefined : (event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={state.name}
    >
      <div className="attachment-viewer-header flex flex-shrink-0 items-center gap-1 px-2 py-1.5">
        <span className="attachment-viewer-title min-w-0 flex-1 truncate text-xs" title={state.name}>
          {state.name}
          {canPage ? (
            <span className="attachment-viewer-count ml-1.5">
              {index + 1}/{total}
            </span>
          ) : null}
        </span>
        {canPage ? (
          <>
            <button
              type="button"
              className="attachment-viewer-btn"
              onClick={() => page(-1)}
              title="이전 이미지 (←)"
              aria-label="이전 이미지"
            >
              ‹
            </button>
            <button
              type="button"
              className="attachment-viewer-btn"
              onClick={() => page(1)}
              title="다음 이미지 (→)"
              aria-label="다음 이미지"
            >
              ›
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="attachment-viewer-btn"
          onClick={() => step(-1)}
          title="축소 (−)"
          aria-label="축소"
        >
          −
        </button>
        <button
          type="button"
          className="attachment-viewer-zoom"
          onClick={() => setZoom(null)}
          title="화면에 맞추기 (0)"
        >
          {zoomLabel}
        </button>
        <button
          type="button"
          className="attachment-viewer-btn"
          onClick={() => step(1)}
          title="확대 (+)"
          aria-label="확대"
        >
          +
        </button>
        <button
          type="button"
          className="attachment-viewer-btn attachment-viewer-btn-wide"
          onClick={onOpenExternal}
          title="기본 앱으로 열기"
        >
          기본 앱
        </button>
        <button
          type="button"
          className="attachment-viewer-btn"
          onClick={onClose}
          title="닫기 (Esc)"
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
      <div
        ref={canvasRef}
        className="attachment-viewer-canvas flex min-h-0 flex-1 overflow-auto p-2"
        onContextMenu={(event) => {
          openMenu(event, { dataUrl: state.dataUrl, filename: state.name })
        }}
      >
        <img
          src={state.dataUrl}
          alt={state.name}
          className={cn('attachment-viewer-image', (zoom === null || !natural) && 'is-fit')}
          style={
            zoom !== null && natural
              ? {
                  width: `${Math.round(natural.width * zoom)}px`,
                  height: `${Math.round(natural.height * zoom)}px`,
                  maxWidth: 'none',
                  maxHeight: 'none'
                }
              : undefined
          }
          onLoad={(event) =>
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
          onContextMenu={(event) => {
            openMenu(event, { dataUrl: state.dataUrl, filename: state.name })
          }}
          draggable={false}
        />
      </div>
      {imageMenu}
    </div>
  )

  if (isFloating) {
    return (
      <InteractionUI className="attachment-viewer-root flex h-full w-full flex-col" role="presentation">
        {shell}
      </InteractionUI>
    )
  }

  // Browser / no-panel fallback — same footprint as search/settings (≤1024px × 80%).
  return (
    <InteractionUI
      className="attachment-viewer-root fixed inset-0 z-[110] flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-[1] h-[80%] max-h-[80%] w-full max-w-[1024px]">
        {shell}
      </div>
    </InteractionUI>
  )
}

export function AttachmentViewerProvider({ children }: { children: ReactNode }): ReactElement {
  const { alert } = useAppDialog()
  const [state, setState] = useState<AttachmentViewerState | null>(null)

  const loadInline = useCallback(
    async (eventId: string, attachmentId: string): Promise<boolean> => {
      const image = await readEventAttachmentImage(eventId, attachmentId)
      if (!image) return false
      setState({
        eventId,
        attachmentId,
        name: image.name,
        dataUrl: image.dataUrl,
        images: image.images.length > 0 ? image.images : [{ id: attachmentId, name: image.name }]
      })
      return true
    },
    []
  )

  const openAttachment = useCallback(
    async (eventId: string, attachmentId: string) => {
      try {
        // Probe first — non-images go straight to the OS / download path.
        const image = await readEventAttachmentImage(eventId, attachmentId)
        if (!image) {
          await openEventAttachment(eventId, attachmentId)
          return
        }
        const opened = await openAttachmentViewerPanel(eventId, attachmentId)
        if (opened) return
        setState({
          eventId,
          attachmentId,
          name: image.name,
          dataUrl: image.dataUrl,
          images: image.images.length > 0 ? image.images : [{ id: attachmentId, name: image.name }]
        })
      } catch (error) {
        await alert(error instanceof Error ? error.message : '첨부 파일을 열 수 없습니다.')
      }
    },
    [alert]
  )

  const eventId = state?.eventId
  const selectImage = useCallback(
    (attachmentId: string) => {
      if (!eventId) return
      void loadInline(eventId, attachmentId)
    },
    [eventId, loadInline]
  )

  const close = useCallback(() => {
    window.neoCalendar?.blockPanelOutsideClose?.(450)
    setState(null)
  }, [])

  const openExternal = useCallback(async () => {
    if (!state) return
    try {
      await openEventAttachment(state.eventId, state.attachmentId)
    } catch (error) {
      await alert(error instanceof Error ? error.message : '첨부 파일을 열 수 없습니다.')
    }
  }, [alert, state])

  const value = useMemo(() => ({ openAttachment }), [openAttachment])

  return (
    <AttachmentViewerContext.Provider value={value}>
      {children}
      {state ? (
        <AttachmentImageViewer
          state={state}
          surface="inline"
          onClose={close}
          onSelect={selectImage}
          onOpenExternal={openExternal}
        />
      ) : null}
    </AttachmentViewerContext.Provider>
  )
}

/**
 * Opens an attachment: images in the floating (or inline) viewer, everything else
 * in the OS default app. Falls back to the OS app when no provider is mounted.
 */
export function useOpenAttachment(): AttachmentViewerApi['openAttachment'] {
  const context = useContext(AttachmentViewerContext)
  const { alert } = useAppDialog()
  return useMemo(() => {
    if (context) return context.openAttachment
    return async (eventId: string, attachmentId: string) => {
      try {
        const image = await readEventAttachmentImage(eventId, attachmentId)
        if (image) {
          const opened = await openAttachmentViewerPanel(eventId, attachmentId)
          if (opened) return
        }
        await openEventAttachment(eventId, attachmentId)
      } catch (error) {
        await alert(error instanceof Error ? error.message : '첨부 파일을 열 수 없습니다.')
      }
    }
  }, [alert, context])
}
