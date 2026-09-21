import { useState } from 'react'
import { daysInMonth } from '@sp/domain'
import { prepareSheet, type PreparedSheet } from '@sp/recognize'
import type { Rgba } from '@sp/vision'
import { fileToRgba, rotateRgba } from '../experimental/browser-image'
import { nameStrips, workToCanvas, type NameStrip } from '../experimental/name-strip'
import { createOcrWorker } from '../experimental/tesseract'

type Phase = 'idle' | 'decoding' | 'detecting' | 'ocring' | 'done' | 'error'
type Rotation = 0 | 90 | 180 | 270

interface Timing {
  label: string
  ms: number
}

interface RowResult {
  row: number
  text: string
  confidence: number
  canvas: HTMLCanvasElement
  box: { x: number; y: number; w: number; h: number }
}

interface Diagnostic {
  workSize: { w: number; h: number }
  rows: number
  cols: number
  nurseRows: number
  overlay: HTMLCanvasElement
  suspectRotation: boolean
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
  const [runOcr, setRunOcr] = useState(false)
  const [rotation, setRotation] = useState<Rotation>(0)
  const [year, setYear] = useState(now)
  const [month, setMonth] = useState(nowMonth)
  const [originalImg, setOriginalImg] = useState<Rgba | null>(null)

  async function run(file: File | null, degCw: Rotation, alsoOcr: boolean) {
    setPhase('decoding')
    setProgress('이미지 디코딩 중...')
    setError('')
    setTimings([])
    setRows([])
    setDiag(null)
    try {
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

      const strips: NameStrip[] = nameStrips(sheet)

      // 진단 오버레이: 전체 이미지 위에 크롭 박스를 노랑으로 그림
      const overlay = workToCanvas(sheet, 800)
      const octx = overlay.getContext('2d')!
      const s = overlay.width / sheet.detect.work.width
      octx.strokeStyle = 'rgba(255, 220, 0, 0.9)'
      octx.lineWidth = 2
      for (const strip of strips) {
        octx.strokeRect(strip.box.x * s, strip.box.y * s, strip.box.w * s, strip.box.h * s)
      }
      const firstNurse = sheet.nurseRows[0]
      if (firstNurse !== undefined) {
        const d1 = sheet.boxOf(firstNurse, 1)
        octx.strokeStyle = 'rgba(255, 0, 0, 0.9)'
        octx.beginPath()
        octx.moveTo(d1.x * s, 0)
        octx.lineTo(d1.x * s, overlay.height)
        octx.stroke()
      }
      // 열이 행보다 작으면 회전 의심 (근무표는 항상 가로가 더 길다)
      const suspect = sheet.detect.lattice.cols < sheet.detect.lattice.rows
      setDiag({
        workSize: { w: sheet.detect.work.width, h: sheet.detect.work.height },
        rows: sheet.rows,
        cols: sheet.detect.lattice.cols,
        nurseRows: sheet.nurseRows.length,
        overlay,
        suspectRotation: suspect,
      })

      if (!alsoOcr) {
        setRows(strips.map(s => ({ row: s.row, text: '(OCR 스킵)', confidence: 0, canvas: s.canvas, box: s.box })))
        setTimings([
          { label: '이미지 디코딩', ms: t1 - t0 },
          { label: '격자 검출', ms: t2 - t1 },
          { label: '총합', ms: t2 - t0 },
        ])
        setPhase('done')
        return
      }

      setPhase('ocring')
      setProgress('Tesseract 로드 중... (첫 실행 시 20MB 다운로드)')
      const t3 = performance.now()
      const worker = await createOcrWorker('kor')
      const t4 = performance.now()

      const out: RowResult[] = []
      try {
        for (let i = 0; i < strips.length; i++) {
          setProgress(`OCR ${i + 1}/${strips.length}`)
          const strip = strips[i]
          const r = await worker.recognize(strip.canvas)
          out.push({ row: strip.row, text: r.text.trim(), confidence: r.confidence, canvas: strip.canvas, box: strip.box })
        }
      } finally {
        await worker.terminate()
      }
      const t5 = performance.now()

      setRows(out)
      setTimings([
        { label: '이미지 디코딩', ms: t1 - t0 },
        { label: '격자 검출', ms: t2 - t1 },
        { label: 'Tesseract 로드', ms: t4 - t3 },
        { label: `OCR (${strips.length}행)`, ms: t5 - t4 },
        { label: '총합', ms: t5 - t0 },
      ])
      setProgress('')
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  const disabled = phase === 'decoding' || phase === 'detecting' || phase === 'ocring'

  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
     <div style={{ padding: 20, paddingBottom: 60, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui' }}>
      <button onClick={onBack} style={{ marginBottom: 12 }}>‹ 뒤로</button>
      <h2 style={{ marginTop: 0 }}>이름 인식 실측 (Tesseract.js)</h2>
      <p style={{ color: '#666', fontSize: 14 }}>
        사진을 선택하면 격자를 검출하고, 각 간호사 행의 이름 칸을 Tesseract 로 OCR 합니다.
        번들에 포함되지 않으므로 첫 실행 시 약 20 MB 다운로드가 발생합니다.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        <label>년<input type="number" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 80, marginLeft: 4 }} /></label>
        <label>월<input type="number" min={1} max={12} value={month} onChange={e => setMonth(+e.target.value)} style={{ width: 50, marginLeft: 4 }} /></label>
        <label>회전
          <select value={rotation} disabled={disabled} onChange={e => {
            const r = +e.target.value as Rotation
            setRotation(r)
            if (originalImg) void run(null, r, runOcr)
          }} style={{ marginLeft: 4 }}>
            <option value={0}>0°</option>
            <option value={90}>90° CW</option>
            <option value={180}>180°</option>
            <option value={270}>270° CW</option>
          </select>
        </label>
        <label><input type="checkbox" checked={runOcr} onChange={e => setRunOcr(e.target.checked)} /> OCR 실행 (끄면 검출·크롭만)</label>
        <label style={{ padding: '6px 12px', background: '#2C6BED', color: 'white', borderRadius: 6, cursor: 'pointer' }}>
          사진 선택
          <input type="file" accept="image/*" hidden disabled={disabled}
            onChange={e => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void run(f, rotation, runOcr)
            }} />
        </label>
        {originalImg && <button disabled={disabled} onClick={() => void run(null, rotation, runOcr)}>다시 검출</button>}
      </div>

      {progress && <p style={{ color: '#2C6BED' }}>{progress}</p>}
      {error && <p style={{ color: '#c0392b', whiteSpace: 'pre-wrap' }}>❌ {error}</p>}

      {diag && (
        <div style={{ background: '#F7F7F8', padding: 12, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>격자 진단</h3>
          <p style={{ fontSize: 13, color: '#555' }}>
            작업 이미지 {diag.workSize.w}×{diag.workSize.h} · 격자 {diag.rows}행 × {diag.cols}열 · 간호사 {diag.nurseRows}명
            <br />노랑 = 이름 칸으로 크롭한 영역, 빨강 세로선 = day1 열 시작
          </p>
          {diag.suspectRotation && (
            <p style={{ color: '#B4560A', fontWeight: 600 }}>
              ⚠︎ 열({diag.cols})이 행({diag.rows})보다 적습니다. 이미지가 회전되어 있을 가능성이 높으니 회전을 90°로 바꿔 다시 시도해 보세요.
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
          <h3>인식 결과 ({rows.length}행)</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#f5f5f7' }}>
                <th style={cellStyle}>행</th>
                <th style={cellStyle}>이미지</th>
                <th style={cellStyle}>인식</th>
                <th style={cellStyle}>신뢰도</th>
                <th style={cellStyle}>박스</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.row}>
                  <td style={cellStyle}>{r.row}</td>
                  <td style={cellStyle}><CanvasCell canvas={r.canvas} maxWidth={240} /></td>
                  <td style={{ ...cellStyle, fontFamily: 'monospace', whiteSpace: 'pre' }}>{r.text || '(빈값)'}</td>
                  <td style={cellStyle}>{r.confidence.toFixed(0)}</td>
                  <td style={{ ...cellStyle, fontSize: 11, color: '#888' }}>
                    x={r.box.x} y={r.box.y}<br />w={r.box.w} h={r.box.h}
                  </td>
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
  border: '1px solid #ddd',
  padding: 6,
  textAlign: 'left',
  verticalAlign: 'middle',
}

function CanvasCell({ canvas, maxWidth }: { canvas: HTMLCanvasElement; maxWidth?: number }) {
  return (
    <div ref={el => {
      if (el && !el.contains(canvas)) {
        el.innerHTML = ''
        el.appendChild(canvas)
        if (maxWidth) { canvas.style.maxWidth = maxWidth + 'px'; canvas.style.height = 'auto' }
      }
    }} />
  )
}
