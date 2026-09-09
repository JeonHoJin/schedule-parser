/** 8비트 단일 채널 이미지 */
export interface Gray {
  width: number
  height: number
  data: Uint8Array // length = width * height
}

/** 8비트 RGBA 이미지 */
export interface Rgba {
  width: number
  height: number
  data: Uint8Array // length = width * height * 4
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 검출된 셀 하나 */
export interface CellBox extends Box {
  cx: number
  cy: number
  area: number
}

export const grayOf = (width: number, height: number): Gray => ({
  width,
  height,
  data: new Uint8Array(width * height),
})
