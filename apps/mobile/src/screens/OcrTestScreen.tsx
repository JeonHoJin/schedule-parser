import { useState } from 'react'
import { daysInMonth, type Roster } from '@sp/domain'
import { prepareSheet, type PreparedSheet } from '@sp/recognize'
import type { Rgba } from '@sp/vision'
import { fileToRgba, rotateRgba } from '../experimental/browser-image'
import { readExifDate } from '../experimental/exif'
import { fullParse } from '../experimental/full-parse'
import { nameStrips, workToCanvas, type NameStrip } from '../experimental/name-strip'
import { createOcrWorker } from '../experimental/tesseract'
import { listRosters, saveRoster } from '../local-storage'
import type { LocalRoster } from '../data'

type Phase = 'idle' | 'decoding' | 'detecting' | 'parsing' | 'ocring' | 'saving' | 'done' | 'error'
type Rotation = 0 | 90 | 180 | 270

interface Timing { label: string; ms: number }
interface RowResult { row: number; text: string; confidence: number; canvas: HTMLCanvasElement }
interface Diagnostic {
  workSize: { w: number; h: number }
  rows: number
  cols: number
  nurseRows: number
  overlay: HTMLCanvasElement
  suspectRotation: boolean
}
interface ParseSummary {
  roster: Roster
  counts: Record<string, number>
  empnoOk: number
  empnoMissing: number
}

const now = 2026
const nowMonth = 9

export function OcrTestScreen({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [timings, setTimings] = useState<Timing[]>([])
  const [rows, setRows] = useState<RowResult[]>([])
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [runOcr, setRunOcr] = useState(false)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [year, setYear] = useState(now)
  const [month, setMonth] = useState(nowMonth)
  const [exifNote, setExifNote] = useState('')
  const [originalImg, setOriginalImg] = useState<Rgba | null>(null)

  async function run(file: File | null, degCw: Rotation, alsoOcr: boolean) {
    setPhase('decoding')
    setProgress('이미지 디코딩 중...')
    setError('')
    setTimings([]); setRows([]); setDiag(null); setSummary(null)
    try {
      if (file) {
        const d = await readExifDate(file).catch(() => null)
        if (d) {
          setYear(d.year); setMonth(d.month)
          setExifNote(`EXIF: ${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} 촬영 → 년/월 자동 설정 (필요시 조정)`)
        } else setExifNote('EXIF 촬영 날짜 없음 — 년/월을 직접 확인하세요')
      }

      const t0 = performance.now()
      const raw = file ? await fileToRgba(file) : originalImg
      if (!raw) throw new Error('사진이 선택되지 않았습니다')
      if (file) setOriginalImg(raw)
      const img = rotateRgba(raw, degCw)
      const t1 = performance.now()

      setPhase('detecting')
      setProgress('격자 검출 중...')
      const days = daysInMonth(year, month)
      let sheet: PreparedSheet
      try {
        sheet = prepareSheet(img, days)
      } catch (e) {
        throw new Error(`격자 검출 실패: ${e instanceof Error ? e.message : e}\n\n회전을 바꿔 다시 시도해 보세요.`)
      }
      const t2 = performance.now()

      // 진단 오버레이
      const strips: NameStrip[] = nameStrips(sheet)
      const overlay = workToCanvas(sheet, 800)
      const octx = overlay.getContext('2d')!
      const s = overlay.width / sheet.detect.work.width
      octx.strokeStyle = 'rgba(255, 220, 0, 0.9)'
      octx.lineWidth = 2
      for (const strip of strips) octx.strokeRect(strip.box.x * s, strip.box.y * s, strip.box.w * s, strip.box.h * s)
      const firstNurse = sheet.nurseRows[0]
      if (firstNurse !== undefined) {
        const d1 = sheet.boxOf(firstNurse, 1)
        octx.strokeStyle = 'rgba(255, 0, 0, 0.9)'
        octx.beginPath(); octx.moveTo(d1.x * s, 0); octx.lineTo(d1.x * s, overlay.height); octx.stroke()
      }
      setDiag({
        workSize: { w: sheet.detect.work.width, h: sheet.detect.work.height },
        rows: sheet.rows, cols: sheet.detect.lattice.cols,
        nurseRows: sheet.nurseRows.length, overlay,
        suspectRotation: sheet.detect.lattice.cols < sheet.detect.lattice.rows,
      })

      setPhase('parsing')
      setProgress('근무표 파싱 중...')
      const t3 = performance.now()
      const parsed = fullParse(img, { id: `roster-${year}-${String(month).padStart(2, '0')}`, year, month, days })
      const t4 = performance.now()

      const counts: Record<string, number> = {}
      for (const c of parsed.roster.cells) counts[c.kind] = (counts[c.kind] ?? 0) + 1
      setSummary({
        roster: parsed.roster,
        counts,
        empnoOk: parsed.empnos.filter(e => e.value).length,
        empnoMissing: parsed.empnos.filter(e => !e.value).length,
      })

      const baseTimings: Timing[] = [
        { label: '이미지 디코딩', ms: t1 - t0 },
        { label: '격자 검출', ms: t2 - t1 },
        { label: '근무표 파싱', ms: t4 - t3 },
      ]

      if (!alsoOcr) {
        setTimings([...baseTimings, { label: '총합', ms: t4 - t0 }])
        setPhase('done')
        return
      }

      setPhase('ocring')
      setProgress('Tesseract 로드 중... (첫 실행 시 20MB 다운로드)')
      const t5 = performance.now()
      const worker = await createOcrWorker('kor')
      const t6 = performance.now()

      const out: RowResult[] = []
      try {
        for (let i = 0; i < strips.length; i++) {
          setProgress(`이름 OCR ${i + 1}/${strips.length}`)
          const strip = strips[i]
          const r = await worker.recognize(strip.canvas)
          out.push({ row: strip.row, text: r.text.trim(), confidence: r.confidence, canvas: strip.canvas })
        }
      } finally { await worker.terminate() }
      const t7 = performance.now()

      setRows(out)
      setTimings([...baseTimings,
        { label: 'Tesseract 로드', ms: t6 - t5 },
        { label: `이름 OCR (${strips.length}행)`, ms: t7 - t6 },
        { label: '총합', ms: t7 - t0 },
      ])
      setProgress('')
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  async function saveAndReturn() {
    if (!summary) return
    setPhase('saving')
    setProgress('저장 중...')
    try {
      const existing = (await listRosters()).find(i => i.roster.id === summary.roster.id)
      if (existing && !window.confirm('같은 년/월 근무표가 이미 있습니다. 덮어쓸까요?')) {
        setPhase('done'); setProgress('')
        return
      }
      // OCR 로 읽은 이름이 있으면 nurses.name 에 반영
      const nameByRow = new Map(rows.map(r => [r.row, r.text.replace(/\s+/g, '')]))
      const nurses = summary.roster.nurses.map((n, i) => {
        const row = i + 2 // 격자 행 (헤더 2행 제외)
        const guess = nameByRow.get(row)
        return { ...n, name: guess || n.name || '' }
      })
      const local: LocalRoster = {
        roster: { ...summary.roster, nurses },
        settings: { reviewThreshold: 0.8 },
        review: { empnos: [], cells: [] },
      }
      await saveRoster(local)
      onBack()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
      setPhase('error')
    } finally { setProgress('') }
  }

  const disabled = phase === 'decoding' || phase === 'detecting' || phase === 'parsing' || phase === 'ocring' || phase === 'saving'

  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
     <div style={{ padding: 20, paddingBottom: 60, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui' }}>
      <button onClick={onBack} style={{ marginBottom: 12 }}>‹ 뒤로</button>
      <h2 style={{ marginTop: 0 }}>근무표 사진 추가</h2>
      <p style={{ color: '#666', fontSize: 14 }}>
        사진을 선택하면 격자를 검출하고 D/E/N/// 코드와 사번을 자동 인식합니다.
        이름 OCR 은 사번이 없는 과거 근무표용 (Tesseract.js 20MB 첫 다운로드).
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        <label>년<input type="number" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 80, marginLeft: 4 }} /></label>
        <label>월<input type="number" min={1} max={12} value={month} onChange={e => setMonth(+e.target.value)} style={{ width: 50, marginLeft: 4 }} /></label>
        <label>회전
          <select value={rotation} disabled={disabled} onChange={e => {
            const r = +e.target.value as Rotation; setRotation(r)
            if (originalImg) void run(null, r, runOcr)
          }} style={{ marginLeft: 4 }}>
            <option value={0}>0°</option>
            <option value={90}>90° CW</option>
            <option value={180}>180°</option>
            <option value={270}>270° CW</option>
          </select>
        </label>
        <label><input type="checkbox" checked={runOcr} onChange={e => setRunOcr(e.target.checked)} /> 이름 OCR 실행</label>
        <label style={{ padding: '6px 12px', background: '#2C6BED', color: 'white', borderRadius: 6, cursor: 'pointer' }}>
          사진 선택
          <input type="file" accept="image/*" hidden disabled={disabled}
            onChange={e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (f) void run(f, rotation, runOcr)
            }} />
        </label>
        {originalImg && <button disabled={disabled} onClick={() => void run(null, rotation, runOcr)}>다시 파싱</button>}
      </div>

      {exifNote && <p style={{ color: '#555', fontSize: 13, margin: '4px 0' }}>{exifNote}</p>}
      {progress && <p style={{ color: '#2C6BED' }}>{progress}</p>}
      {error && <p style={{ color: '#c0392b', whiteSpace: 'pre-wrap' }}>❌ {error}</p>}

      {summary && (
        <div style={{ background: '#EEF9EE', padding: 12, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>파싱 결과</h3>
          <p style={{ fontSize: 14, margin: 0 }}>
            근무표 ID <code>{summary.roster.id}</code> · 간호사 {summary.roster.nurses.length}명 · 셀 {summary.roster.cells.length}칸
            <br />코드 분포: {Object.entries(summary.counts).map(([k, v]) => `${k}:${v}`).join(' · ')}
            <br />사번 인식 성공 {summary.empnoOk} · 실패 {summary.empnoMissing}
          </p>
          <button
            disabled={disabled}
            onClick={saveAndReturn}
            style={{ marginTop: 12, padding: '8px 16px', background: '#2C6BED', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >이 근무표를 저장</button>
        </div>
      )}

      {diag && (
        <div style={{ background: '#F7F7F8', padding: 12, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>격자 진단</h3>
          <p style={{ fontSize: 13, color: '#555' }}>
            작업 이미지 {diag.workSize.w}×{diag.workSize.h} · 격자 {diag.rows}행 × {diag.cols}열 · 간호사 {diag.nurseRows}명
            <br />노랑 = 이름 칸으로 크롭한 영역, 빨강 세로선 = day1 열 시작
          </p>
          {diag.suspectRotation && (
            <p style={{ color: '#B4560A', fontWeight: 600 }}>
              ⚠︎ 열({diag.cols})이 행({diag.rows})보다 적습니다. 회전이 필요할 수 있어요.
            </p>
          )}
          <CanvasCell canvas={diag.overlay} maxWidth={840} />
        </div>
      )}

      {timings.length > 0 && (
        <div style={{ background: '#F0F4FF', padding: 12, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>타이밍</h3>
          {timings.map(t => (
            <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
              <span>{t.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.ms.toFixed(0)} ms</span>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <h3>이름 OCR 결과 ({rows.length}행)</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#f5f5f7' }}>
                <th style={cellStyle}>행</th>
                <th style={cellStyle}>이미지</th>
                <th style={cellStyle}>인식</th>
                <th style={cellStyle}>신뢰도</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.row}>
                  <td style={cellStyle}>{r.row}</td>
                  <td style={cellStyle}><CanvasCell canvas={r.canvas} maxWidth={240} /></td>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', whiteSpace: 'pre' }}>{r.text || '(빈값)'}</td>
                  <td style={cellStyle}>{r.confidence.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
     </div>
    </div>
  )
}

const cellStyle: React.CSSProperties = {
  border: '1px solid #ddd', padding: 6, textAlign: 'left', verticalAlign: 'middle',
}

function CanvasCell({ canvas, maxWidth }: { canvas: HTMLCanvasElement; maxWidth?: number }) {
  return (
    <div ref={el => {
      if (el && !el.contains(canvas)) {
        el.innerHTML = ''; el.appendChild(canvas)
        if (maxWidth) { canvas.style.maxWidth = maxWidth + 'px'; canvas.style.height = 'auto' }
      }
    }} />
  )
}
