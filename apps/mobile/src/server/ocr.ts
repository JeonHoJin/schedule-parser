/**
 * 서버 OCR(`ocr-read`)로 이름·사번 칸을 읽는다. 사진 전체가 아니라 칸 조각만 보낸다.
 * 서버는 조각을 메모리에서만 처리하고 버린다.
 */
import { server, ServerError } from './index'

export interface CellReading {
  text: string
  confidence: number
}

interface OcrLine {
  text: string
  confidence: number
}

export const looksLikeName = (t: string) => /^[가-힣]{2,5}$/.test(t)
export const looksLikeEmpno = (t: string, digits = 6) => t.length === digits && /^\d+$/.test(t)

/** 한 칸에서 읽힌 줄들을 합친다. 칸 안의 공백은 인쇄 간격일 뿐이라 지운다. */
export function joinLines(lines: OcrLine[]): CellReading {
  return {
    text: lines.map(l => l.text).join('').replace(/\s+/g, ''),
    confidence: lines.length ? Math.min(...lines.map(l => l.confidence)) : 0,
  }
}

export interface RowReading {
  name?: CellReading
  empno?: CellReading
}

/** `[이름0, 사번0, 이름1, 사번1, …]` 순서로 보낸 결과를 행별로 되돌린다. */
export function pairRows(results: OcrLine[][], rows: number): RowReading[] {
  return Array.from({ length: rows }, (_, i) => ({
    name: results[2 * i] ? joinLines(results[2 * i]) : undefined,
    empno: results[2 * i + 1] ? joinLines(results[2 * i + 1]) : undefined,
  }))
}

function pngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',', 2)[1]
}

export interface SheetTitle {
  year: number
  month: number
  /** "OO병동" 처럼 제목에 적힌 병동 이름 */
  ward?: string
}

/**
 * 표 제목 줄(예: "OO병동 2026 년 10 월 근무표")에서 년·월·병동을 찾는다.
 * 출력일자(2026-09-15 …)는 근무표의 달이 아니므로 "년 … 월" 표기만 인정한다.
 */
export function parseTitle(lines: string[]): SheetTitle | null {
  for (const line of lines) {
    const m = line.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/)
    if (!m) continue
    const year = Number(m[1]), month = Number(m[2])
    if (month < 1 || month > 12) continue
    const ward = lines.map(l => l.match(/([0-9A-Za-z가-힣]{1,12}병동)/)?.[1]).find(Boolean)
    return { year, month, ...(ward ? { ward } : {}) }
  }
  return null
}

async function read(images: string[]): Promise<OcrLine[][]> {
  const res = await server.op('ocr-read', {
    body: JSON.stringify({ images }),
    headers: { 'content-type': 'application/json' },
  })
  if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
  return (await res.json() as { results: OcrLine[][] }).results
}

type RowCanvases = Array<{ nameCanvas: HTMLCanvasElement; empnoCanvas: HTMLCanvasElement }>

export async function readRows(rows: RowCanvases): Promise<RowReading[]> {
  return pairRows(await read(rows.flatMap(r => [pngBase64(r.nameCanvas), pngBase64(r.empnoCanvas)])), rows.length)
}

/**
 * 제목 조각과 이름·사번 칸을 한 번의 요청으로 읽는다.
 * `flipped` 는 제목이 격자 아래(180° 돌린 조각)에서 읽혔다는 뜻 — 사진을 거꾸로 파싱했다.
 */
export async function readSheet(
  titles: { above: HTMLCanvasElement[]; below: HTMLCanvasElement[] },
  rows: RowCanvases,
): Promise<{ title: SheetTitle | null; flipped: boolean; rows: RowReading[] }> {
  const n = titles.above.length + titles.below.length
  const results = await read([
    ...[...titles.above, ...titles.below].map(pngBase64),
    ...rows.flatMap(r => [pngBase64(r.nameCanvas), pngBase64(r.empnoCanvas)]),
  ])
  const text = (from: number, to: number) => results.slice(from, to).map(lines => lines.map(l => l.text).join(' '))
  const above = parseTitle(text(0, titles.above.length))
  const below = above ? null : parseTitle(text(titles.above.length, n))
  return { title: above ?? below, flipped: !above && !!below, rows: pairRows(results.slice(n), rows.length) }
}

/**
 * 제목을 못 읽었을 때의 기본값. 근무표는 보통 전달 중순 이후에 나오므로,
 * 촬영일이 15일 이후면 다음 달로 본다.
 */
export function guessMonth(taken: { year: number; month: number; day: number }): { year: number; month: number } {
  if (taken.day < 15) return { year: taken.year, month: taken.month }
  return taken.month === 12 ? { year: taken.year + 1, month: 1 } : { year: taken.year, month: taken.month + 1 }
}
