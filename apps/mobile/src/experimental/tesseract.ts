/**
 * Tesseract.js 를 CDN 에서 지연 로드해 한글 OCR 을 돌린다.
 *
 * 앱 번들에는 포함하지 않는다 — 이 화면을 여는 사용자만 다운로드한다.
 * WASM (~3 MB) 과 kor.traineddata (~14 MB) 를 처음 한 번 받고 그 뒤엔 캐시된다.
 */

const CDN = 'https://unpkg.com/tesseract.js@6'
const CORE = 'https://unpkg.com/tesseract.js-core@6'
const LANG = 'https://tessdata.projectnaptha.com/4.0.0_fast'

declare global {
  interface Window {
    Tesseract?: unknown
  }
}

interface TesseractApi {
  createWorker: (
    lang: string,
    oem: number,
    opts: { workerPath: string; corePath: string; langPath: string },
  ) => Promise<{
    recognize: (input: HTMLCanvasElement | ImageBitmap | Blob | string) => Promise<{
      data: { text: string; confidence: number }
    }>
    terminate: () => Promise<void>
  }>
}

let scriptPromise: Promise<TesseractApi> | null = null

function loadScript(): Promise<TesseractApi> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<TesseractApi>((resolve, reject) => {
    if ((window as { Tesseract?: TesseractApi }).Tesseract) {
      resolve((window as { Tesseract?: TesseractApi }).Tesseract!)
      return
    }
    const s = document.createElement('script')
    s.src = `${CDN}/dist/tesseract.min.js`
    s.async = true
    s.onload = () => {
      const api = (window as { Tesseract?: TesseractApi }).Tesseract
      if (!api) reject(new Error('Tesseract 스크립트를 로드했지만 전역이 노출되지 않았습니다'))
      else resolve(api)
    }
    s.onerror = () => reject(new Error('Tesseract 스크립트를 내려받지 못했습니다'))
    document.head.appendChild(s)
  }).catch(err => {
    scriptPromise = null
    throw err
  })
  return scriptPromise
}

export interface OcrWorker {
  recognize: (canvas: HTMLCanvasElement) => Promise<{ text: string; confidence: number }>
  terminate: () => Promise<void>
}

export async function createOcrWorker(lang = 'kor'): Promise<OcrWorker> {
  const T = await loadScript()
  const worker = await T.createWorker(lang, 1, {
    workerPath: `${CDN}/dist/worker.min.js`,
    corePath: CORE,
    langPath: LANG,
  })
  return {
    recognize: async (canvas) => {
      const { data } = await worker.recognize(canvas)
      return { text: data.text, confidence: data.confidence }
    },
    terminate: () => worker.terminate(),
  }
}
