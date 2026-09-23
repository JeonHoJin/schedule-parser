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

export async function readRows(
  rows: Array<{ nameCanvas: HTMLCanvasElement; empnoCanvas: HTMLCanvasElement }>,
): Promise<RowReading[]> {
  const images = rows.flatMap(r => [pngBase64(r.nameCanvas), pngBase64(r.empnoCanvas)])
  const res = await server.op('ocr-read', {
    body: JSON.stringify({ images }),
    headers: { 'content-type': 'application/json' },
  })
  if (!res.ok) throw new ServerError(res.status, `HTTP ${res.status}`)
  const out = await res.json() as { results: OcrLine[][] }
  return pairRows(out.results, rows.length)
}
