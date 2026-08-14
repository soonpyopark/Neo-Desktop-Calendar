/**
 * Self-contained HTML for calendar export (day-list + month-grid).
 * Visuals follow the PDF/Excel day-list palette and month-grid colors.
 */
import { EXPORT_COLORS } from './exportColors.js'
import { COMPLETED_LABEL_COLOR, splitEventTitleRuns } from './eventTags.js'
import { parseSimpleMarkdown } from '../simpleMarkdown.js'

const DAY_LIST_COLORS = {
  headerBg: '#deebd6',
  dateBg: '#deebd6',
  weekendBg: '#fff2cc',
  border: '#a3af97',
  text: '#3a3858',
  saturday: '#174ea6',
  sunday: '#b3261e',
  detailBg: '#e5e0ec',
  detailBorder: '#b9a3d6'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function dayOfWeekFromKey(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

function dayListDateColor(dayOfWeek, isHoliday) {
  if (dayOfWeek === 0 || isHoliday) return DAY_LIST_COLORS.sunday
  if (dayOfWeek === 6) return DAY_LIST_COLORS.saturday
  return DAY_LIST_COLORS.text
}

function weekdayHeaderColor(dayIndex, weekStartsOn) {
  const dayOfWeek = (weekStartsOn + dayIndex) % 7
  if (dayOfWeek === 0) return EXPORT_COLORS.sunday
  if (dayOfWeek === 6) return EXPORT_COLORS.saturday
  return EXPORT_COLORS.heading
}

function safeHttpUrl(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.href
  } catch {
    return ''
  }
}

function renderMdHtml(text) {
  return parseSimpleMarkdown(String(text ?? ''))
    .map((run) => {
      const chunks = String(run.text ?? '').split('\n')
      return chunks
        .map((chunk, index) => {
          let html = escapeHtml(chunk)
          if (run.code) html = `<code>${html}</code>`
          if (run.bold) html = `<strong>${html}</strong>`
          if (run.italic) html = `<em>${html}</em>`
          if (run.strike) html = `<s>${html}</s>`
          if (run.href) {
            const href = safeHttpUrl(run.href)
            if (href) {
              html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`
            }
          }
          return (index > 0 ? '<br>' : '') + html
        })
        .join('')
    })
    .join('')
}

function renderTitleHtml(head) {
  return splitEventTitleRuns(head)
    .map((run) =>
      run.completed
        ? `<span class="completed">${escapeHtml(run.text)}</span>`
        : escapeHtml(run.text)
    )
    .join('')
}

function renderDayListDetails(details) {
  if (!Array.isArray(details) || details.length === 0) return ''
  const lines = details
    .map((detail) => {
      if (detail?.kind === 'description') {
        return `<div class="detail-line">${renderMdHtml(detail.text)}</div>`
      }
      const href = safeHttpUrl(detail?.url)
      if (detail?.kind === 'link' && href) {
        return `<div class="detail-line"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detail.text)}</a></div>`
      }
      return `<div class="detail-line">${escapeHtml(detail?.text ?? '')}</div>`
    })
    .join('')
  return `<div class="details">${lines}</div>`
}

function renderDayListHtml(layout) {
  const rows = (layout.rows ?? [])
    .map((row) => {
      const dayOfWeek = dayOfWeekFromKey(row.dayKey)
      const isHoliday = Boolean(row.isHoliday)
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 || isHoliday
      const dateColor = dayListDateColor(dayOfWeek, isHoliday)
      const events = (row.events ?? [])
        .map(
          (event) => `<div class="event">
            <span class="stripe" style="background:${escapeHtml(event.color || '#f6bf26')}"></span>
            <div class="event-body">
              <div class="head">${renderTitleHtml(event.head ?? event.line ?? '')}</div>
              ${renderDayListDetails(event.details)}
            </div>
          </div>`
        )
        .join('')
      return `<tr class="${isWeekend ? 'weekend' : ''}">
        <td class="date" style="color:${dateColor}">${escapeHtml(row.dateLabel)}</td>
        <td class="content">${events}</td>
      </tr>`
    })
    .join('\n')

  return `<h1>${escapeHtml(layout.title)}</h1>
<table class="day-list">
  <colgroup>
    <col class="date-col">
    <col class="content-col">
  </colgroup>
  <thead>
    <tr><th>날짜</th><th>내용</th></tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>`
}

function renderMonthGridHtml(layout) {
  const weekStartsOn = layout.weekStartsOn === 1 ? 1 : 0
  const showWeek = layout.showWeekNumbers !== false
  const weekdayCells = (layout.weekdayHeaders ?? [])
    .map((label, index) => {
      const color = weekdayHeaderColor(index, weekStartsOn)
      return `<th class="weekday" style="color:${color}">${escapeHtml(label)}</th>`
    })
    .join('')

  const weekRows = (layout.weekRows ?? [])
    .map((week) => {
      const weekCell = showWeek
        ? `<th class="week-num">${escapeHtml(String(week.weekNumber ?? ''))}</th>`
        : ''
      const days = (week.days ?? [])
        .map((day) => {
          const muted = day.inMonth === false
          const today = Boolean(day.isToday)
          const events = (day.events ?? [])
            .map(
              (event) =>
                `<div class="bar"><span class="stripe" style="background:${escapeHtml(event.color || '#f6bf26')}"></span><span class="bar-text">${escapeHtml(event.line ?? '')}</span></div>`
            )
            .join('')
          return `<td class="day${muted ? ' other' : ''}${today ? ' today' : ''}">
            <div class="day-head">
              <span class="solar" style="color:${escapeHtml(day.solarColor || EXPORT_COLORS.heading)}">${escapeHtml(String(day.solar ?? ''))}</span>
              ${day.lunarLabel ? `<span class="lunar">${escapeHtml(day.lunarLabel)}</span>` : ''}
            </div>
            <div class="bars">${events}</div>
          </td>`
        })
        .join('')
      return `<tr>${weekCell}${days}</tr>`
    })
    .join('\n')

  return `<header class="month-title">
  <h1>${escapeHtml(layout.title)}</h1>
  ${layout.lunarMonthLabel ? `<p class="lunar-month">${escapeHtml(layout.lunarMonthLabel)}</p>` : ''}
</header>
<table class="month-grid">
  <thead>
    <tr>${showWeek ? '<th class="week-num"></th>' : ''}${weekdayCells}</tr>
  </thead>
  <tbody>
    ${weekRows}
  </tbody>
</table>`
}

function documentCss(isDayList) {
  // A3: 297mm × 420mm. Day-list prints portrait; month-grid prints landscape
  // (same orientation as the PDF export, one paper size up).
  const pageWidth = isDayList ? '297mm' : '420mm'
  const pageHeight = isDayList ? '420mm' : '297mm'
  const pageMargin = '12mm'
  return `
    :root {
      color-scheme: light;
      --text: ${EXPORT_COLORS.heading};
      --body: ${EXPORT_COLORS.body};
      --muted: ${EXPORT_COLORS.muted};
      --border: ${isDayList ? DAY_LIST_COLORS.border : EXPORT_COLORS.border};
      --page: #ffffff;
      --page-width: ${pageWidth};
      --page-height: ${pageHeight};
      --page-margin: ${pageMargin};
      --content-width: calc(var(--page-width) - var(--page-margin) * 2);
    }
    @page {
      size: A3 ${isDayList ? 'portrait' : 'landscape'};
      margin: ${pageMargin};
    }
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body {
      width: var(--content-width);
      max-width: var(--content-width);
      margin: var(--page-margin) auto;
      padding: 0;
      color: var(--body);
      font: 13px/1.45 "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 20px;
      color: var(--text);
    }
    a { color: #1a73e8; }
    .completed { color: ${COMPLETED_LABEL_COLOR}; font-weight: 700; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    .day-list th, .day-list td {
      border: 1px solid ${DAY_LIST_COLORS.border};
      vertical-align: top;
      padding: 6px 8px;
    }
    .day-list thead th {
      background: ${DAY_LIST_COLORS.headerBg};
      color: ${DAY_LIST_COLORS.text};
      font-size: 12px;
      text-align: center;
    }
    .day-list .date-col { width: 7.6em; }
    .day-list .content-col { width: auto; }
    .day-list .date,
    .day-list thead th:first-child {
      width: 7.6em;
      padding: 6px 0.55em;
      background: ${DAY_LIST_COLORS.dateBg};
      color: ${DAY_LIST_COLORS.text};
      font-weight: 700;
      text-align: center;
      white-space: nowrap;
    }
    .day-list .content { width: auto; }
    .day-list tr.weekend .date,
    .day-list tr.weekend .content { background: ${DAY_LIST_COLORS.weekendBg}; }
    .event {
      display: flex;
      gap: 6px;
      width: 100%;
      margin: 0 0 8px;
    }
    .event:last-child { margin-bottom: 0; }
    .event-body { flex: 1 1 auto; min-width: 0; }
    .stripe {
      flex: 0 0 3px;
      border-radius: 2px;
      align-self: stretch;
      min-height: 1.1em;
    }
    .head { color: var(--body); }
    .details {
      display: block;
      width: 100%;
      margin-top: 4px;
      padding: 6px 8px;
      background: ${DAY_LIST_COLORS.detailBg};
      border: 1px solid ${DAY_LIST_COLORS.detailBorder};
      border-radius: 4px;
      color: var(--muted);
      font-size: 12px;
    }
    .detail-line + .detail-line { margin-top: 4px; }
    .month-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .lunar-month { margin: 0; color: ${EXPORT_COLORS.lunarBlue}; }
    .month-grid th, .month-grid td {
      border: 1px solid ${EXPORT_COLORS.border};
      vertical-align: top;
    }
    .month-grid .weekday {
      background: ${EXPORT_COLORS.weekdayHeaderBg};
      padding: 6px 4px;
      text-align: center;
      font-size: 12px;
    }
    .month-grid .week-num {
      width: 10mm;
      background: ${EXPORT_COLORS.weekColumnBg};
      color: var(--muted);
      text-align: center;
      font-size: 11px;
      font-weight: 600;
    }
    .month-grid .day {
      width: 14.28%;
      min-height: 28mm;
      padding: 4px 5px 6px;
      background: ${EXPORT_COLORS.surface};
    }
    .month-grid .day.other { opacity: 0.55; }
    .month-grid .day.today { background: ${EXPORT_COLORS.todayBg}; }
    .day-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
    .solar { font-weight: 700; }
    .lunar { color: ${EXPORT_COLORS.lunarBlue}; font-size: 11px; }
    .bar { display: flex; gap: 4px; margin-top: 3px; font-size: 11px; color: var(--body); }
    .bar-text { min-width: 0; overflow-wrap: anywhere; }
    @media print {
      html { background: #fff; }
      body { width: auto; max-width: none; margin: 0; }
      a { color: inherit; text-decoration: none; }
    }
  `
}

/**
 * @param {{ layout?: string, title?: string }} layout
 * @returns {string}
 */
export function buildHtmlDocument(layout) {
  const isDayList = layout?.layout === 'dayList'
  const body = isDayList ? renderDayListHtml(layout) : renderMonthGridHtml(layout)
  const title = escapeHtml(layout?.title || '캘린더 내보내기')
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${documentCss(isDayList)}</style>
</head>
<body>
${body}
</body>
</html>
`
}
