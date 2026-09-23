import { useState } from 'react'
import { daysInMonth, type Roster } from '@sp/domain'
import type { Rgba } from '@sp/vision'
import { cropRgba, fileToRgba, FULL_CROP, type CropRect } from '../experimental/browser-image'
import { CropStep } from '../components/CropStep'
import { carryMyNurse } from '../roster-edit'
import { readExifDate } from '../experimental/exif'
import { fullParse } from '../experimental/full-parse'
import { rowStrips, workToCanvas, type RowStrips } from '../experimental/name-strip'
import { looksLikeEmpno, looksLikeName, readRows } from '../server/ocr'
import { listRosters, saveRoster } from '../local-storage'
import type { LocalRoster } from '../data'

type Phase = 'idle' | 'decoding' | 'cropping' | 'parsing' | 'ocring' | 'saving' | 'done' | 'error'
type Rotation = 0 | 90 | 180 | 270
type RotationChoice = Rotation | 'auto'

interface Timing { label: string; ms: number }
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
  rotationUsed: Rotation
  score: number
}

/** 편집 가능한 간호사 한 명의 상태 */
interface NurseEdit {
  row: number
  /** roster.nurses 의 원래 id (수정하지 않음) */
  originalId: string
  empno: string
  empnoConfidence: number
  empnoNeedsReview: boolean
  empnoSource: 'server' | 'device'
  name: string
  /** 서버가 읽은 원문 (형식에 안 맞아 이름으로 채우지 않은 경우 참고용) */
  ocrNameRaw: string
  ocrConfidence: number
  nameCanvas: HTMLCanvasElement
  empnoCanvas: HTMLCanvasElement
}

const now = 2026
const nowMonth = 9

export function OcrTestScreen({ onClose }: { onClose: (saved?: { id: string; carriedMe: boolean }) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [timings, setTimings] = useState<Timing[]>([])
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [nurses, setNurses] = useState<NurseEdit[]>([])
  const [ocrNote, setOcrNote] = useState('')
  const [rotation, setRotation] = useState<RotationChoice>('auto')
  const [year, setYear] = useState(now)
  const [month, setMonth] = useState(nowMonth)
  const [exifNote, setExifNote] = useState('')
  const [originalImg, setOriginalImg] = useState<Rgba | null>(null)
  const [cropRect, setCropRect] = useState<CropRect>(FULL_CROP)
  const [decodeMs, setDecodeMs] = useState(0)

  function resetResults() {
    setError('')
    setTimings([]); setDiag(null); setSummary(null); setNurses([]); setOcrNote('')
  }

  /** 사진을 고르면 디코딩만 하고 자르기 단계로 넘어간다. */
  async function pick(file: File) {
    setPhase('decoding')
    setProgress('이미지 디코딩 중...')
    resetResults()
    try {
      const d = await readExifDate(file).catch(() => null)
      if (d) {
        setYear(d.year); setMonth(d.month)
        setExifNote(`EXIF: ${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} 촬영 → 년/월 자동 설정 (필요시 조정)`)
      } else setExifNote('EXIF 촬영 날짜 없음 — 년/월을 직접 확인하세요')
      const t0 = performance.now()
      setOriginalImg(await fileToRgba(file))
      setDecodeMs(performance.now() - t0)
      setCropRect(FULL_CROP)
      setProgress('')
      setPhase('cropping')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress('')
      setPhase('error')
    }
  }

  async function run(choice: RotationChoice, crop: CropRect) {
    setPhase('parsing')
    resetResults()
    try {
      if (!originalImg) throw new Error('사진이 선택되지 않았습니다')
      const t0 = performance.now() - decodeMs
      const raw = cropRgba(originalImg, crop)
      const t1 = performance.now()

      setProgress(choice === 'auto' ? '자동 회전 감지 + 근무표 파싱 중...' : '근무표 파싱 중...')
      // 파싱은 동기 작업이라, 진행 문구가 먼저 그려지도록 한 프레임 양보한다.
      await new Promise(r => setTimeout(r, 30))
      const days = daysInMonth(year, month)
      const parsed = fullParse(raw, {
        id: `roster-${year}-${String(month).padStart(2, '0')}`, year, month, days,
        rotation: choice === 'auto' ? undefined : choice,
      })
      const t2 = performance.now()

      // 진단 오버레이
      const sheet = parsed.sheet
      const strips: RowStrips[] = rowStrips(sheet)
      const overlay = workToCanvas(sheet, 800)
      const octx = overlay.getContext('2d')!
      const s = overlay.width / sheet.detect.work.width
      octx.lineWidth = 2
      for (const strip of strips) {
        octx.strokeStyle = 'rgba(255, 220, 0, 0.9)'
        octx.strokeRect(strip.nameBox.x * s, strip.nameBox.y * s, strip.nameBox.w * s, strip.nameBox.h * s)
        octx.strokeStyle = 'rgba(80, 200, 255, 0.9)'
        octx.strokeRect(strip.empnoBox.x * s, strip.empnoBox.y * s, strip.empnoBox.w * s, strip.empnoBox.h * s)
      }
      setDiag({
        workSize: { w: sheet.detect.work.width, h: sheet.detect.work.height },
        rows: sheet.rows, cols: sheet.detect.lattice.cols,
        nurseRows: sheet.nurseRows.length, overlay,
        suspectRotation: sheet.detect.lattice.cols < sheet.detect.lattice.rows,
      })

      const counts: Record<string, number> = {}
      for (const c of parsed.roster.cells) counts[c.kind] = (counts[c.kind] ?? 0) + 1
      setSummary({
        roster: parsed.roster,
        counts,
        empnoOk: parsed.empnos.filter(e => e.value).length,
        empnoMissing: parsed.empnos.filter(e => !e.value).length,
        rotationUsed: parsed.rotationUsed,
        score: parsed.score,
      })

      // 초기 검수 리스트: OCR 없이도 사번은 채워둔다
      const initial: NurseEdit[] = strips.map((strip, i) => {
        const e = parsed.empnos[i]
        const n = parsed.roster.nurses[i]
        return {
          row: strip.row,
          originalId: n.id,
          empno: e?.value ?? '',
          empnoConfidence: e?.minScore ?? 0,
          empnoNeedsReview: e?.needsReview ?? true,
          empnoSource: 'device',
          name: '',
          ocrNameRaw: '',
          ocrConfidence: 0,
          nameCanvas: strip.nameCanvas,
          empnoCanvas: strip.empnoCanvas,
        }
      })
      setNurses(initial)

      const baseTimings: Timing[] = [
        { label: '이미지 디코딩·자르기', ms: t1 - t0 },
        { label: `파싱 (회전 ${parsed.rotationUsed}°)`, ms: t2 - t1 },
      ]

      setPhase('ocring')
      setProgress('서버에서 이름·사번 인식 중…')
      const t3 = performance.now()
      try {
        const readings = await readRows(strips)
        const merged = initial.map((n, i) => {
          const name = readings[i]?.name
          const empno = readings[i]?.empno
          const serverEmpno = empno && looksLikeEmpno(empno.text) ? empno : undefined
          return {
            ...n,
            name: name && looksLikeName(name.text) ? name.text : '',
            ocrNameRaw: name?.text ?? '',
            ocrConfidence: name?.confidence ?? 0,
            ...(serverEmpno
              ? { empno: serverEmpno.text, empnoConfidence: serverEmpno.confidence, empnoNeedsReview: false, empnoSource: 'server' as const }
              : {}),
          }
        })
        setNurses(merged)
        const names = merged.filter(n => n.name).length
        const empnos = merged.filter(n => n.empnoSource === 'server').length
        setOcrNote(`서버 인식: 이름 ${names}/${merged.length} · 사번 ${empnos}/${merged.length}. 비어 있거나 노란 칸만 확인해 주세요.`)
      } catch (e) {
        console.warn('server OCR failed', e)
        setOcrNote('서버 인식을 쓰지 못해, 이 기기에서 읽은 사번만 채웠어요. 이름은 직접 입력해 주세요.')
      }
      const t4 = performance.now()
      setTimings([...baseTimings, { label: '서버 이름·사번 인식', ms: t4 - t3 }, { label: '총합', ms: t4 - t0 }])
      setProgress('')
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress('')
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
      // 편집된 사번·이름을 nurses 배열에 반영
      const editByOriginalId = new Map(nurses.map(n => [n.originalId, n]))
      const editByRowIndex = nurses.map((n, i) => ({ i, n }))
      const patchedNurses = summary.roster.nurses.map((n, i) => {
        const edit = editByOriginalId.get(n.id) ?? editByRowIndex[i]?.n
        if (!edit) return { ...n, name: n.name ?? '' }
        const empno = edit.empno.replace(/\D/g, '').trim()
        return {
          ...n,
          empNo: empno,
          id: empno || n.id,
          name: (edit.name || '').trim(),
        }
      })
      // 사번을 편집한 경우 cells 의 nurseId 도 업데이트
      const idRemap = new Map<string, string>()
      summary.roster.nurses.forEach((old, i) => {
        const newId = patchedNurses[i].id
        if (old.id !== newId) idRemap.set(old.id, newId)
      })
      const patchedCells = idRemap.size
        ? summary.roster.cells.map(c => idRemap.has(c.nurseId) ? { ...c, nurseId: idRemap.get(c.nurseId)! } : c)
        : summary.roster.cells

      const roster = { ...summary.roster, nurses: patchedNurses, cells: patchedCells }
      const myNurseId = carryMyNurse(roster, await listRosters())
      const local: LocalRoster = {
        roster,
        settings: { myNurseId, reviewThreshold: 0.8 },
        review: { empnos: [], cells: [] },
      }
      await saveRoster(local)
      onClose({ id: summary.roster.id, carriedMe: myNurseId !== undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
      setPhase('error')
    } finally { setProgress('') }
  }

  function updateNurse(row: number, patch: Partial<Pick<NurseEdit, 'name' | 'empno'>>) {
    setNurses(prev => prev.map(n => n.row === row ? { ...n, ...patch } : n))
  }

  const disabled = phase === 'decoding' || phase === 'parsing' || phase === 'ocring' || phase === 'saving'

  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
     <div style={{ padding: 20, paddingBottom: 60, maxWidth: 960, margin: '0 auto', fontFamily: 'system-ui' }}>
      <button onClick={() => onClose()} style={{ marginBottom: 12 }}>‹ 뒤로</button>
      <h2 style={{ marginTop: 0 }}>근무표 사진 추가</h2>
      <p style={{ color: '#666', fontSize: 14 }}>
        사진을 선택하면 이 기기에서 근무 코드를 읽고, 이름·사번 칸만 서버로 보내 인식합니다.
        서버는 받은 칸 이미지를 저장하지 않습니다. 저장 전에 아래 표에서 사번·이름을 고칠 수 있어요.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        <label>년
          <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4}
            value={year ? String(year) : ''}
            onChange={e => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
              setYear(digits ? +digits : 0)
            }}
            onBlur={() => { if (!year || year < 2000) setYear(now) }}
            style={{ width: 70, marginLeft: 4, padding: 4, fontSize: 16 }} />
        </label>
        <label>월
          <select value={month} onChange={e => setMonth(+e.target.value)} style={{ marginLeft: 4, padding: 4, fontSize: 16 }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
        </label>
        <label>회전
          <select value={rotation} disabled={disabled} onChange={e => {
            const v = e.target.value
            const r: RotationChoice = v === 'auto' ? 'auto' : (+v as Rotation)
            setRotation(r)
            if (originalImg && phase !== 'cropping') void run(r, cropRect)
          }} style={{ marginLeft: 4, padding: 4, fontSize: 16 }}>
            <option value="auto">자동</option>
            <option value={0}>0°</option>
            <option value={90}>90° CW</option>
            <option value={180}>180°</option>
            <option value={270}>270° CW</option>
          </select>
        </label>
        <label style={{ padding: '6px 12px', background: '#2C6BED', color: 'white', borderRadius: 6, cursor: 'pointer' }}>
          사진 선택
          <input type="file" accept="image/*" hidden disabled={disabled}
            onChange={e => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (f) void pick(f)
            }} />
        </label>
        {originalImg && phase !== 'cropping' && <>
          <button disabled={disabled} onClick={() => void run(rotation, cropRect)}>다시 파싱</button>
          <button disabled={disabled} onClick={() => { resetResults(); setPhase('cropping') }}>다시 자르기</button>
        </>}
      </div>

      {phase === 'cropping' && originalImg && (
        <CropStep image={originalImg} initial={cropRect}
          onCancel={() => { setOriginalImg(null); setPhase('idle') }}
          onConfirm={rect => { setCropRect(rect); void run(rotation, rect) }} />
      )}

      {exifNote && <p style={{ color: '#555', fontSize: 13, margin: '4px 0' }}>{exifNote}</p>}
      {progress && <p style={{ color: '#2C6BED' }}>{progress}</p>}
      {ocrNote && !progress && <p style={{ color: '#555', fontSize: 13 }}>{ocrNote}</p>}
      {error && <p style={{ color: '#c0392b', whiteSpace: 'pre-wrap' }}>❌ {error}</p>}

      {summary && (
        <div style={{ background: '#EEF9EE', padding: 12, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>파싱 결과</h3>
          <p style={{ fontSize: 14, margin: 0 }}>
            근무표 ID <code>{summary.roster.id}</code> · 간호사 {summary.roster.nurses.length}명 · 셀 {summary.roster.cells.length}칸
            <br />코드 분포: {Object.entries(summary.counts).map(([k, v]) => `${k}:${v}`).join(' · ')}
            <br />사번 인식 성공 {summary.empnoOk} · 실패 {summary.empnoMissing}
            <br /><span style={{ color: '#555' }}>회전 {summary.rotationUsed}° 적용됨 (자동 감지 점수 {summary.score})</span>
          </p>
          <button
            disabled={disabled}
            onClick={saveAndReturn}
            style={{ marginTop: 12, padding: '8px 16px', background: '#2C6BED', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
          >이 근무표를 저장</button>
        </div>
      )}

      {nurses.length > 0 && (
        <div>
          <h3>간호사 목록 검수 ({nurses.length}명)</h3>
          <p style={{ fontSize: 13, color: '#666', marginTop: 0 }}>
            사번·이름이 틀린 곳을 직접 수정해 주세요. 사번을 바꾸면 근무 기록의 소속도 함께 이동합니다.
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f5f7' }}>
                <th style={cellStyle}>행</th>
                <th style={cellStyle}>사번 이미지</th>
                <th style={cellStyle}>사번</th>
                <th style={cellStyle}>이름 이미지</th>
                <th style={cellStyle}>이름</th>
              </tr>
            </thead>
            <tbody>
              {nurses.map(n => (
                <tr key={n.row} style={n.empnoNeedsReview || !n.name ? { background: '#FFF7EC' } : undefined}>
                  <td style={cellStyle}>{n.row}</td>
                  <td style={cellStyle}><CanvasCell canvas={n.empnoCanvas} maxWidth={140} /></td>
                  <td style={cellStyle}>
                    <input
                      type="text" inputMode="numeric" pattern="[0-9]*"
                      value={n.empno}
                      onChange={e => updateNurse(n.row, { empno: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                      style={{ width: 100, padding: 4, fontSize: 16, fontFamily: 'monospace' }}
                    />
                    <div style={{ fontSize: 10, color: '#888' }}>
                      {n.empnoSource === 'server' ? '서버' : '기기'} {n.empnoConfidence.toFixed(2)}{n.empnoNeedsReview ? ' · 검수' : ''}
                    </div>
                  </td>
                  <td style={cellStyle}><CanvasCell canvas={n.nameCanvas} maxWidth={180} /></td>
                  <td style={cellStyle}>
                    <input
                      type="text"
                      value={n.name}
                      onChange={e => updateNurse(n.row, { name: e.target.value.slice(0, 20) })}
                      style={{ width: 120, padding: 4, fontSize: 16 }}
                    />
                    {n.ocrNameRaw && n.ocrNameRaw !== n.name && (
                      <div style={{ fontSize: 10, color: '#888' }}>서버가 읽은 글자 "{n.ocrNameRaw}"</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {diag && (
        <div style={{ background: '#F7F7F8', padding: 12, borderRadius: 8, margin: '16px 0' }}>
          <h3 style={{ marginTop: 0 }}>격자 진단</h3>
          <p style={{ fontSize: 13, color: '#555' }}>
            작업 이미지 {diag.workSize.w}×{diag.workSize.h} · 격자 {diag.rows}행 × {diag.cols}열 · 간호사 {diag.nurseRows}명
            <br />노랑 = 이름 칸, 파랑 = 사번 칸으로 크롭한 영역
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
