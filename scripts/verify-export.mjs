/**
 * Node-based verification for unified calendar export layouts / filters / buffers.
 * Run: node scripts/verify-export.mjs
 */
import assert from 'node:assert/strict'
import { prepareDayListExportLayout } from '../src/shared/mdcExport/dayListExportLayout.js'
import { prepareRangeGridExportLayout } from '../src/shared/mdcExport/monthExportLayout.js'
import { resolveExportRangePreset, listDateKeysInRange } from '../src/shared/mdcExport/exportRange.js'
import { filterEventsForExport } from '../src/shared/mdcExport/exportFilters.js'
import { normalizeExportRequest } from '../src/shared/exportCalendarHelpers.js'
import {
  buildExcelBuffer,
  buildHtmlBuffer,
  buildPdfBuffer,
  getExcelExportFileName,
  getHtmlExportFileName,
  getPdfExportFileName
} from '../src/main/export/calendarExport.mjs'
import { exportFormatLabel, normalizeExportFormat } from '../src/shared/exportCalendarHelpers.js'
import { buildHtmlDocument } from '../src/shared/mdcExport/htmlExport.js'

const HOLIDAYS = 'holidays-kr'

function makeStore() {
  return {
    calendars: [
      { id: 'primary', name: '내 캘린더', color: '#039be5', visible: true },
      { id: 'hidden', name: '숨김', color: '#d50000', visible: false },
      { id: HOLIDAYS, name: '공휴일', color: '#d50000', visible: true }
    ],
    tags: [{ id: 't1', name: '중요', color: '#f4511e', sortOrder: 0 }],
    events: [
      {
        id: 'e1',
        title: '하루 일정',
        calendarId: 'primary',
        startDate: '2026-07-02',
        endDate: '2026-07-02',
        allDay: true,
        completed: false,
        description: '회의실 A\n준비물 챙기기',
        links: [{ id: 'l1', url: 'https://example.com/meet', title: '회의 링크' }],
        link: '',
        attachments: [{ id: 'a1', name: '자료.pdf', storedName: '자료.pdf' }]
      },
      {
        id: 'e2',
        title: '여러날',
        calendarId: 'primary',
        startDate: '2026-07-03',
        endDate: '2026-07-05',
        allDay: true,
        completed: false
      },
      {
        id: 'e3',
        title: '완료됨',
        calendarId: 'primary',
        startDate: '2026-07-04',
        endDate: '2026-07-04',
        allDay: true,
        completed: true
      },
      {
        id: 'e4',
        title: '숨긴캘린더',
        calendarId: 'hidden',
        startDate: '2026-07-06',
        endDate: '2026-07-06',
        allDay: true,
        completed: false
      },
      {
        id: 'e5',
        title: '광복절',
        calendarId: HOLIDAYS,
        startDate: '2026-08-15',
        endDate: '2026-08-15',
        allDay: true,
        completed: false
      },
      {
        id: 'e6',
        title: '매주 회의',
        calendarId: 'primary',
        startDate: '2026-07-01',
        endDate: '2026-07-01',
        allDay: false,
        startTime: '10:00',
        endTime: '11:00',
        completed: false,
        repeat: 'weekly'
      }
    ],
    settings: {
      viewOptions: {
        weekStartsOnSunday: true,
        showWeekNumbers: true
      }
    }
  }
}

function assertNormalize() {
  const legacy = normalizeExportRequest({ format: 'excel', year: 2026, month: 7 })
  assert.equal(legacy.startDate, '2026-07-01')
  assert.equal(legacy.endDate, '2026-07-31')
  assert.equal(legacy.layout, 'monthGrid')

  const swapped = normalizeExportRequest({
    format: 'pdf',
    layout: 'dayList',
    startDate: '2026-07-10',
    endDate: '2026-07-01'
  })
  assert.equal(swapped.startDate, '2026-07-01')
  assert.equal(swapped.endDate, '2026-07-10')
  assert.equal(normalizeExportFormat('html'), 'html')
  assert.equal(normalizeExportRequest({
    format: 'html',
    layout: 'dayList',
    startDate: '2026-07-01',
    endDate: '2026-07-31'
  }).format, 'html')
  assert.equal(exportFormatLabel('html'), 'HTML')

  assert.throws(() => normalizeExportRequest({ format: 'excel' }))
}

function assertPresets() {
  const ref = new Date(2026, 6, 15) // Jul 15 2026
  const month = resolveExportRangePreset('thisMonth', ref, 0)
  assert.equal(month.startDate, '2026-07-01')
  assert.equal(month.endDate, '2026-07-31')
  const week = resolveExportRangePreset('thisWeek', ref, 0)
  assert.equal(week.startDate, '2026-07-12')
  assert.equal(week.endDate, '2026-07-18')
  const year = resolveExportRangePreset('thisYear', ref, 0)
  assert.equal(year.startDate, '2026-01-01')
  assert.equal(year.endDate, '2026-12-31')
}

function assertFilters() {
  const store = makeStore()
  const all = filterEventsForExport(store.events, store.calendars, {
    includeCompleted: true,
    includeHolidays: true,
    excludeHiddenCalendars: false,
    asAdmin: true
  })
  assert.equal(all.length, store.events.length)

  const noHidden = filterEventsForExport(store.events, store.calendars, {
    excludeHiddenCalendars: true,
    asAdmin: true
  })
  assert.ok(!noHidden.some((e) => e.calendarId === 'hidden'))

  const noCompleted = filterEventsForExport(store.events, store.calendars, {
    includeCompleted: false,
    asAdmin: true
  })
  assert.ok(!noCompleted.some((e) => e.completed))

  const noHolidays = filterEventsForExport(store.events, store.calendars, {
    includeHolidays: false,
    asAdmin: true
  })
  assert.ok(!noHolidays.some((e) => e.calendarId === HOLIDAYS))
}

function assertDayListMultiDay() {
  const store = makeStore()
  const layout = prepareDayListExportLayout(
    store,
    { startDate: '2026-07-01', endDate: '2026-07-07' },
    { includeCompleted: true, includeHolidays: true, excludeHiddenCalendars: true, asAdmin: true }
  )
  assert.equal(layout.rows.length, 7)
  const byKey = Object.fromEntries(layout.rows.map((row) => [row.dayKey, row]))
  assert.ok(byKey['2026-07-03'].events.some((e) => e.line.includes('여러날')))
  assert.ok(byKey['2026-07-04'].events.some((e) => e.line.includes('여러날')))
  assert.ok(byKey['2026-07-05'].events.some((e) => e.line.includes('여러날')))
  assert.ok(byKey['2026-07-01'].events.some((e) => e.line.includes('매주 회의')))
  // empty day still present
  assert.ok(byKey['2026-07-07'])
  assert.equal(byKey['2026-07-07'].events.length, 0)

  const detail = byKey['2026-07-02'].events.find((e) => e.line.includes('하루 일정'))
  assert.ok(detail)
  // Description body only — no "설명:" label (day-list / PDF).
  assert.ok(detail.line.includes('회의실 A\n준비물 챙기기'))
  assert.ok(!detail.line.includes('설명:'))
  assert.ok(detail.details?.some((d) => d.kind === 'description' && d.text.includes('회의실 A')))
  assert.ok(detail.line.includes('링크: 회의 링크 — https://example.com/meet'))
  assert.ok(detail.line.includes('첨부: 자료.pdf'))
  assert.equal(layout.rows[0].dayKey, '2026-07-01')
  assert.equal(layout.rows[layout.rows.length - 1].dayKey, '2026-07-07')

  const desc = prepareDayListExportLayout(
    store,
    { startDate: '2026-07-01', endDate: '2026-07-07' },
    {
      includeCompleted: true,
      includeHolidays: true,
      excludeHiddenCalendars: true,
      asAdmin: true,
      dayListSortDesc: true
    }
  )
  assert.equal(desc.rows[0].dayKey, '2026-07-07')
  assert.equal(desc.rows[desc.rows.length - 1].dayKey, '2026-07-01')

  const html = buildHtmlDocument(layout)
  assert.ok(html.startsWith('<!DOCTYPE html>'))
  assert.ok(html.includes('하루 일정'))
  assert.ok(html.includes('날짜'))
  assert.ok(html.includes('https://example.com/meet'))
  assert.ok(html.includes('첨부: 자료.pdf'))
  assert.ok(!html.includes('class="detail-thumb"'))

  const withImage = buildHtmlDocument(
    layout,
    new Map([['e1::a1', 'data:image/jpeg;base64,QQ==']])
  )
  assert.ok(withImage.includes('class="detail-thumb"'))
  assert.ok(withImage.includes('data:image/jpeg;base64,QQ=='))
}

function assertMonthGridRange() {
  const store = makeStore()
  const layout = prepareRangeGridExportLayout(
    store,
    { startDate: '2026-07-01', endDate: '2026-08-15' },
    { includeCompleted: true, includeHolidays: true, excludeHiddenCalendars: true, asAdmin: true }
  )
  assert.ok(layout.weekRows.length >= 6)
  const days = layout.weekRows.flatMap((week) => week.days)
  const inRange = days.filter((day) => day.inMonth)
  const keys = listDateKeysInRange('2026-07-01', '2026-08-15')
  assert.equal(inRange.length, keys.length)
  assert.ok(days.some((day) => !day.inMonth), 'padding days outside range')
}

async function assertBuffers() {
  const store = makeStore()
  const short = { layout: 'monthGrid', startDate: '2026-07-01', endDate: '2026-07-31' }
  const year = { layout: 'dayList', startDate: '2026-01-01', endDate: '2026-12-31' }
  const options = {
    includeCompleted: true,
    includeHolidays: true,
    excludeHiddenCalendars: true,
    asAdmin: true
  }

  const excelMonth = await buildExcelBuffer(store, short, options)
  assert.ok(excelMonth.byteLength > 1000)
  const pdfMonth = await buildPdfBuffer(store, short, options)
  assert.ok(pdfMonth.byteLength > 1000)

  const excelList = await buildExcelBuffer(store, year, options)
  assert.ok(excelList.byteLength > 1000)
  const pdfList = await buildPdfBuffer(store, { ...year, layout: 'dayList' }, options)
  assert.ok(pdfList.byteLength > 1000)
  const htmlList = await buildHtmlBuffer(store, { ...year, layout: 'dayList' }, options)
  const htmlText = new TextDecoder().decode(htmlList)
  assert.ok(htmlText.startsWith('<!DOCTYPE html>'))
  assert.ok(htmlText.includes('하루 일정'))
  assert.ok(htmlText.includes('날짜'))
  const htmlMonth = await buildHtmlBuffer(store, short, options)
  assert.ok(new TextDecoder().decode(htmlMonth).includes('2026년 7월') || htmlMonth.byteLength > 200)

  const name = getExcelExportFileName(short)
  assert.match(name, /calendar_monthGrid_20260701-20260731_/)
  const pdfName = getPdfExportFileName(year)
  assert.match(pdfName, /calendar_dayList_20260101-20261231_/)
  const htmlName = getHtmlExportFileName(year)
  assert.match(htmlName, /calendar_dayList_20260101-20261231_.*\.html$/)
}

async function main() {
  assertNormalize()
  assertPresets()
  assertFilters()
  assertDayListMultiDay()
  assertMonthGridRange()
  await assertBuffers()
  console.log('verify-export: all checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
