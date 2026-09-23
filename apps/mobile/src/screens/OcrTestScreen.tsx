import { useState } from 'react'
import { daysInMonth, type Roster } from '@sp/domain'
import type { Rgba } from '@sp/vision'
import { cropRgba, fileToRgba, FULL_CROP, type CropRect } from '../experimental/browser-image'
import { CropStep } from '../components/CropStep'
import { carryMyNurse } from '../roster-edit'
import { readExifDate } from '../experimental/exif'
import { fullParse, type FullParseResult } from '../experimental/full-parse'
import { rowStrips, titleStrips, workToCanvas, type RowStrips } from '../experimental/name-strip'
import { guessMonth, looksLikeEmpno, looksLikeName, readRows, readSheet, type RowReading } from '../server/ocr'
import { listRosters, saveRoster } from '../local-storage'
import type { LocalRoster } from '../data'

type Phase = 'idle' | 'decoding' | 'cropping' | 'parsing' | 'ocring' | 'saving' | 'done' | 'error'
type Rotation = 0 | 90 | 180 | 270

interface Timing { label: string; ms: number }
interface Diagnostic {
  workSize: { w: number; h: number }
  rows: number
  cols: number
  nurseRows: number
  overlay: HTMLCanvasElement
  rotation: Rotation
  score: number
  counts: Record<string, number>
}

interface YearMonth { year: number; month: number }
/** 근무표의 달을 어디서 알아냈는지 */
type PeriodSource = 'title' | 'photo' | 'manual'

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
  /** 표가 잘린 부분 등 근무자가 아닌 줄: 저장할 때 뺀다 */
  excluded: boolean
}

const rosterId = ({ year, month }: YearMonth) => `roster-${year}-${String(month).padStart(2, '0')}`

function parse(img: Rgba, period: YearMonth, rotation?: Rotation): FullParseResult {
  return fullParse(img, { id: rosterId(period), ...period, days: daysInMonth(period.year, period.month), rotation })
}

/** 파싱 결과와(있으면) 서버 인식 결과로 검수 표의 행을 만든다. */
function buildEdits(parsed: FullParseResult, strips: RowStrips[], readings?: RowReading[]): NurseEdit[] {
  return strips.map((strip, i) => {
    const e = parsed.empnos[i]
    const name = readings?.[i]?.name
    const empno = readings?.[i]?.empno
    const serverEmpno = empno && looksLikeEmpno(empno.text) ? empno : undefined
    return {
      row: strip.row,
      originalId: parsed.roster.nurses[i].id,
      empno: serverEmpno?.text ?? e?.value ?? '',
      empnoConfidence: serverEmpno?.confidence ?? e?.minScore ?? 0,
      empnoNeedsReview: serverEmpno ? false : e?.needsReview ?? true,
      empnoSource: serverEmpno ? 'server' : 'device',
      name: name && looksLikeName(name.text) ? name.text : '',
      ocrNameRaw: name?.text ?? '',
      ocrConfidence: name?.confidence ?? 0,
      nameCanvas: strip.nameCanvas,
      empnoCanvas: strip.empnoCanvas,
      excluded: false,
    }
  })
}

/** 달을 바꿔 다시 파싱할 때 이미 읽었거나 고친 이름·사번은 그대로 둔다. */
function keepReadings(n: NurseEdit): Partial<NurseEdit> {
  return {
    empno: n.empno, empnoConfidence: n.empnoConfidence, empnoNeedsReview: n.empnoNeedsReview,
    empnoSource: n.empnoSource, name: n.name, ocrNameRaw: n.ocrNameRaw, ocrConfidence: n.ocrConfidence,
    excluded: n.excluded,
  }
}

function diagnose(parsed: FullParseResult, strips: RowStrips[]): Diagnostic {
  const sheet = parsed.sheet
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
  const counts: Record<string, number> = {}
  for (const c of parsed.roster.cells) counts[c.kind] = (counts[c.kind] ?? 0) + 1
  return {
    workSize: { w: sheet.detect.work.width, h: sheet.detect.work.height },
    rows: sheet.rows, cols: sheet.detect.lattice.cols, nurseRows: sheet.nurseRows.length,
    overlay, rotation: parsed.rotationUsed, score: parsed.score, counts,
  }
}

/** 파싱은 동기 작업이라, 진행 문구가 먼저 그려지도록 한 프레임 양보한다. */
const frame = () => new Promise(r => setTimeout(r, 30))

export function OcrTestScreen({ onClose }: { onClose: (saved?: { id: string }) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [timings, setTimings] = useState<Timing[]>([])
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [nurses, setNurses] = useState<NurseEdit[]>([])
  const [ocrNote, setOcrNote] = useState('')
  const [originalImg, setOriginalImg] = useState<Rgba | null>(null)
  const [cropRect, setCropRect] = useState<CropRect>(FULL_CROP)
  const [decodeMs, setDecodeMs] = useState(0)
  const [guess, setGuess] = useState<YearMonth>(() => {
    const now = new Date()
    return guessMonth({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })
  })
  const [period, setPeriod] = useState<(YearMonth & { source: PeriodSource }) | null>(null)
  const [rotation, setRotation] = useState<Rotation | undefined>()
  const [editPeriod, setEditPeriod] = useState<YearMonth | null>(null)

  function resetResults() {
    setError('')
    setTimings([]); setDiag(null); setRoster(null); setNurses([]); setOcrNote('')
    setPeriod(null); setEditPeriod(null)
  }

  /** 사진을 고르면 디코딩만 하고 자르기 단계로 넘어간다. */
  async function pick(file: File) {
    setPhase('decoding')
    setProgress('사진을 여는 중…')
    resetResults()
    try {
      const taken = await readExifDate(file).catch(() => null)
      if (taken) setGuess(guessMonth(taken))
      const t0 = performance.now()
      setOriginalImg(await fileToRgba(file))
      setDecodeMs(performance.now() - t0)
      setCropRect(FULL_CROP)
      setRotation(undefined)
      setProgress('')
      setPhase('cropping')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress('')
      setPhase('error')
    }
  }

  /**
   * 회전은 자동으로 찾고, 근무표의 달은 표 제목을 서버에서 읽어 정한다.
   * 제목이 격자 아래에서 읽히면(사진을 거꾸로 파싱) 180° 돌려서, 제목의 달이 짐작과 다르면
   * 그 달의 일수로 한 번 더 파싱한다.
   */
  async function analyze(crop: CropRect) {
    setPhase('parsing')
    resetResults()
    try {
      if (!originalImg) throw new Error('사진이 선택되지 않았습니다')
      setProgress('근무표를 읽는 중…')
      await frame()
      const t0 = performance.now()
      const img = cropRgba(originalImg, crop)
      let parsed = parse(img, guess)
      let strips = rowStrips(parsed.sheet)
      const t1 = performance.now()

      setPhase('ocring')
      setProgress('서버에서 근무표 달·이름·사번을 읽는 중…')
      let readings: RowReading[] | undefined
      let found: (YearMonth & { ward?: string }) | null = null
      let flipped = false
      try {
        const out = await readSheet(titleStrips(parsed.sheet), strips)
        readings = out.rows
        found = out.title
        flipped = out.flipped
      } catch (e) {
        console.warn('server OCR failed', e)
      }
      const t2 = performance.now()

      let source: PeriodSource = 'photo'
      let use: YearMonth = guess
      if (found) {
        source = 'title'
        use = { year: found.year, month: found.month }
        const otherMonth = use.year !== guess.year || use.month !== guess.month
        if (flipped || otherMonth) {
          const turn = flipped ? ((parsed.rotationUsed + 180) % 360) as Rotation : parsed.rotationUsed
          setProgress(flipped ? '사진 방향을 바로잡아 다시 읽는 중…' : `${use.year}년 ${use.month}월 근무표로 다시 읽는 중…`)
          await frame()
          parsed = parse(img, use, turn)
          const again = rowStrips(parsed.sheet)
          // 뒤집힌 채로 잘랐던 이름·사번 조각은 엉뚱한 칸이므로 다시 읽는다.
          if (readings && (flipped || again.length !== strips.length)) readings = await readRows(again).catch(() => undefined)
          strips = again
        }
      }
      const t3 = performance.now()

      const edits = buildEdits(parsed, strips, readings)
      setRoster({ ...parsed.roster, ward: found?.ward ?? parsed.roster.ward })
      setNurses(edits)
      setPeriod({ ...use, source })
      setRotation(parsed.rotationUsed)
      setDiag(diagnose(parsed, strips))
      if (readings) {
        const names = edits.filter(n => n.name).length
        const empnos = edits.filter(n => n.empnoSource === 'server').length
        setOcrNote(`서버 인식: 이름 ${names}/${edits.length} · 사번 ${empnos}/${edits.length}. 비어 있거나 노란 칸만 확인해 주세요.`)
      } else {
        setOcrNote('서버 인식을 쓰지 못해, 이 기기에서 읽은 사번만 채웠어요. 이름은 직접 입력해 주세요.')
      }
      if (source !== 'title') setEditPeriod(use)
      setTimings([
        { label: '사진 열기', ms: decodeMs },
        { label: `자르기·파싱 (회전 ${parsed.rotationUsed}°)`, ms: t1 - t0 },
        { label: '서버 인식', ms: t2 - t1 },
        ...(t3 - t2 > 5 ? [{ label: '방향·달을 바로잡아 다시 파싱', ms: t3 - t2 }] : []),
        { label: '총합', ms: decodeMs + t3 - t0 },
      ])
      setProgress('')
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress('')
      setPhase('error')
    }
  }

  /** 사용자가 달을 직접 고친 경우: 같은 회전으로 다시 파싱하고, 이름·사번 입력은 그대로 둔다. */
  async function reparseFor(next: YearMonth) {
    if (!originalImg || !roster) return
    setPhase('parsing')
    setProgress(`${next.year}년 ${next.month}월 근무표로 다시 읽는 중…`)
    setError('')
    await frame()
    try {
      const parsed = parse(cropRgba(originalImg, cropRect), next, rotation)
      const strips = rowStrips(parsed.sheet)
      const fresh = buildEdits(parsed, strips)
      const keep = fresh.length === nurses.length
      setNurses(keep ? fresh.map((n, i) => ({ ...n, ...keepReadings(nurses[i]) })) : fresh)
      setRoster({ ...parsed.roster, ward: roster.ward })
      setPeriod({ ...next, source: 'manual' })
      setEditPeriod(null)
      setDiag(diagnose(parsed, strips))
      if (!keep) setOcrNote('표의 행 수가 달라져 이름을 다시 입력해야 해요.')
      setProgress('')
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProgress('')
      setPhase('error')
    }
  }

  async function saveAndReturn() {
    if (!roster) return
    setPhase('saving')
    setProgress('저장 중…')
    try {
      const saved = await listRosters()
      if (saved.some(i => i.roster.id === roster.id)
        && !window.confirm(`${roster.year}년 ${roster.month}월 근무표가 이미 있습니다. 덮어쓸까요?`)) {
        setPhase('done'); setProgress('')
        return
      }
      // 뺀 줄은 사람과 근무 칸을 함께 지운다
      const excludedIds = new Set(nurses.filter(n => n.excluded).map(n => n.originalId))
      const keptNurses = roster.nurses.filter(n => !excludedIds.has(n.id))
      const keptCells = roster.cells.filter(c => !excludedIds.has(c.nurseId))
      if (!keptNurses.length) throw new Error('저장할 근무자가 없습니다.')
      // 편집된 사번·이름을 nurses 배열에 반영
      const editByOriginalId = new Map(nurses.map(n => [n.originalId, n]))
      const patchedNurses = keptNurses.map(n => {
        const edit = editByOriginalId.get(n.id)
        if (!edit) return { ...n, name: n.name ?? '' }
        const empno = edit.empno.replace(/\D/g, '').trim()
        return { ...n, empNo: empno, id: empno || n.id, name: (edit.name || '').trim() }
      })
      // 사번을 편집한 경우 cells 의 nurseId 도 업데이트
      const idRemap = new Map<string, string>()
      keptNurses.forEach((old, i) => {
        if (old.id !== patchedNurses[i].id) idRemap.set(old.id, patchedNurses[i].id)
      })
      const cells = idRemap.size
        ? keptCells.map(c => idRemap.has(c.nurseId) ? { ...c, nurseId: idRemap.get(c.nurseId)! } : c)
        : keptCells

      const next = { ...roster, nurses: patchedNurses, cells }
      const myNurseId = carryMyNurse(next, saved)
      const local: LocalRoster = {
        roster: next,
        settings: { myNurseId, reviewThreshold: 0.8 },
        review: { empnos: [], cells: [] },
      }
      await saveRoster(local)
      onClose({ id: roster.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
      setPhase('error')
    } finally { setProgress('') }
  }

  function updateNurse(row: number, patch: Partial<Pick<NurseEdit, 'name' | 'empno' | 'excluded'>>) {
    setNurses(prev => prev.map(n => n.row === row ? { ...n, ...patch } : n))
  }

  const disabled = phase === 'decoding' || phase === 'parsing' || phase === 'ocring' || phase === 'saving'
  const samePeriod = !!editPeriod && !!period && editPeriod.year === period.year && editPeriod.month === period.month
  const validYear = !!editPeriod && editPeriod.year >= 2000 && editPeriod.year <= 2200

  const photoInput = (label: string, className: string) => (
    <label className={`${className}${disabled ? ' disabled' : ''}`}>
      {label}
      <input type="file" accept="image/*" hidden disabled={disabled}
        onChange={e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (f) void pick(f)
        }} />
    </label>
  )
  const busy = phase === 'decoding' || phase === 'parsing' || phase === 'ocring'
  const kept = nurses.filter(n => !n.excluded).length
  const excluded = nurses.length - kept

  return (
    <div className="upload-page">
      <header className="local-header">
        <div className="title-row">
          <button type="button" className="back-button" aria-label="근무표로 돌아가기" onClick={() => onClose()}>‹</button>
          <h1>근무표 사진 추가</h1>
        </div>
      </header>

      <div className="upload-body">
        {!originalImg && !busy && (
          <div className="photo-pick">
            {photoInput('사진 선택', 'photo-button')}
          </div>
        )}

        {busy && (
          <div className="photo-pick">
            <span className="spinner" aria-hidden="true" />
            <p className="progress" role="status">{progress}</p>
          </div>
        )}

        {phase === 'cropping' && originalImg && (
          <CropStep image={originalImg} initial={cropRect}
            onCancel={() => { setOriginalImg(null); setPhase('idle') }}
            onConfirm={rect => { setCropRect(rect); void analyze(rect) }} />
        )}

        {error && <p className="local-error upload-error" role="alert">{error}</p>}
        {phase === 'error' && originalImg && (
          <div className="upload-actions">
            <button type="button" onClick={() => { resetResults(); setPhase('cropping') }}>다시 자르기</button>
            {photoInput('다른 사진', 'secondary-button')}
          </div>
        )}

        {roster && period && !busy && (
          <section className="result-card" aria-label="인식 결과">
            <h2>{period.year}년 {period.month}월 근무표{roster.ward ? ` · ${roster.ward}` : ''}</h2>
            <p className={period.source === 'photo' ? 'result-source warn' : 'result-source'}>
              {period.source === 'title' && '표 제목에서 읽었어요.'}
              {period.source === 'manual' && '직접 고른 달이에요.'}
              {period.source === 'photo' && '표 제목을 읽지 못해 촬영 날짜로 짐작했어요. 맞는지 확인해 주세요.'}
              {editPeriod === null && (
                <button type="button" className="link-button" disabled={disabled}
                  onClick={() => setEditPeriod({ year: period.year, month: period.month })}>달 바꾸기</button>
              )}
            </p>
            {editPeriod && (
              <div className="period-edit">
                <label>년
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} aria-label="근무표 년도"
                    value={editPeriod.year ? String(editPeriod.year) : ''}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                      setEditPeriod({ ...editPeriod, year: digits ? +digits : 0 })
                    }} />
                </label>
                <label>월
                  <select value={editPeriod.month} aria-label="근무표 월"
                    onChange={e => setEditPeriod({ ...editPeriod, month: +e.target.value })}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                  </select>
                </label>
                <button type="button" disabled={disabled || !validYear}
                  onClick={() => samePeriod ? setEditPeriod(null) : void reparseFor(editPeriod)}>
                  {samePeriod ? '이 달이 맞아요' : '이 달로 다시 읽기'}
                </button>
              </div>
            )}
            <p className="result-note">근무자 {kept}명{excluded ? ` (${excluded}줄 뺌)` : ''} · {ocrNote}</p>
            <button type="button" className="primary save-button" disabled={disabled || editPeriod !== null || kept === 0}
              onClick={saveAndReturn}>{phase === 'saving' ? '저장 중…' : '이 근무표를 저장'}</button>
            {editPeriod !== null && <p className="result-hint">달을 먼저 확인해 주세요.</p>}
            <div className="upload-actions">
              <button type="button" disabled={disabled} onClick={() => { resetResults(); setPhase('cropping') }}>다시 자르기</button>
              {photoInput('다른 사진', 'secondary-button')}
            </div>
          </section>
        )}

        {nurses.length > 0 && !busy && (
          <section className="review" aria-labelledby="review-title">
            <h2 id="review-title">이름·사번 확인 ({kept}명)</h2>
            <p className="review-hint">틀리거나 빈 칸만 고쳐 주세요. 표가 잘린 부분처럼 근무자가 아닌 줄은 ✕ 로 빼 주세요.</p>
            <ol className="review-list">
              {nurses.map((n, i) => (
                n.excluded ? (
                  <li key={n.row} className="review-item excluded">
                    <span className="review-no">{i + 1}</span>
                    <span className="excluded-text">
                      뺀 줄{n.name || n.empno ? ` · ${n.name || n.empno}` : ''}
                    </span>
                    <button type="button" className="restore-button" onClick={() => updateNurse(n.row, { excluded: false })}>되돌리기</button>
                  </li>
                ) : (
                <li key={n.row} className={n.empnoNeedsReview || !n.name ? 'review-item warn' : 'review-item'}>
                  <span className="review-no">{i + 1}</span>
                  <label className="review-field">
                    <CanvasCell canvas={n.nameCanvas} />
                    <input type="text" value={n.name} aria-label={`${i + 1}번 이름`} placeholder="이름"
                      onChange={e => updateNurse(n.row, { name: e.target.value.slice(0, 20) })} />
                    {n.ocrNameRaw && n.ocrNameRaw !== n.name && <small>읽은 글자 “{n.ocrNameRaw}”</small>}
                  </label>
                  <label className="review-field">
                    <CanvasCell canvas={n.empnoCanvas} />
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={n.empno} aria-label={`${i + 1}번 사번`} placeholder="사번"
                      className="mono" onChange={e => updateNurse(n.row, { empno: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
                    {n.empnoNeedsReview && <small>확인 필요</small>}
                  </label>
                  <button type="button" className="remove-button" aria-label={`${i + 1}번 줄 빼기`} title="이 줄 빼기"
                    onClick={() => updateNurse(n.row, { excluded: true })}>✕</button>
                </li>
                )
              ))}
            </ol>
          </section>
        )}

        {diag && !busy && (
          <details className="diagnostics">
            <summary>인식 진단 정보</summary>
            <p>
              작업 이미지 {diag.workSize.w}×{diag.workSize.h} · 격자 {diag.rows}행 × {diag.cols}열 · 간호사 {diag.nurseRows}명
              <br />회전 {diag.rotation}° (자동 감지 점수 {diag.score})
              <br />코드 분포: {Object.entries(diag.counts).map(([k, v]) => `${k}:${v}`).join(' · ')}
              <br />노랑 = 이름 칸, 파랑 = 사번 칸으로 크롭한 영역
            </p>
            <CanvasCell canvas={diag.overlay} />
            {timings.map(t => (
              <div key={t.label} className="timing">
                <span>{t.label}</span>
                <span>{t.ms.toFixed(0)} ms</span>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  )
}

function CanvasCell({ canvas }: { canvas: HTMLCanvasElement }) {
  return (
    <div className="canvas-cell" ref={el => {
      if (el && !el.contains(canvas)) { el.innerHTML = ''; el.appendChild(canvas) }
    }} />
  )
}
