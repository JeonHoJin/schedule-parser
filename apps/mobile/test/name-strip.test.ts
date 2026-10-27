import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PreparedSheet } from '@sp/recognize'
import { rowStrips } from '../src/experimental/name-strip'

test('공통 이름 칸을 자르고, 사번 없는 표에서는 흰색 빈 조각을 만든다', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const painted: Array<{ fillStyle: string; args: number[] }> = []
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => {
      const ctx = {
        fillStyle: '',
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
        fillRect(...args: number[]) { painted.push({ fillStyle: this.fillStyle, args }) },
      }
      return { width: 0, height: 0, getContext: () => ctx }
    },
  } })
  try {
    const sheet = {
      detect: { work: { width: 200, height: 60, data: new Uint8ClampedArray(200 * 60 * 4) } },
      nurseRows: [2, 3],
      identityBoxOf: (row: number) => ({ name: { x: 10, y: 10, w: 50, h: 20 },
        empno: row === 2 ? null : { x: 65, y: 10, w: 30, h: 20 } }),
    } as unknown as PreparedSheet
    const [without, withEmpno] = rowStrips(sheet)
    assert.deepEqual(without.nameBox, { x: 7, y: 7, w: 56, h: 26 })
    assert.deepEqual(without.empnoBox, { x: 0, y: 0, w: 1, h: 1 })
    assert.equal(without.empnoCanvas.width, 1)
    assert.equal(without.empnoCanvas.height, 1)
    assert.deepEqual(painted, [{ fillStyle: '#fff', args: [0, 0, 1, 1] }])
    assert.deepEqual(withEmpno.empnoBox, { x: 62, y: 7, w: 36, h: 26 })
    assert.equal(withEmpno.empnoCanvas.width, 36)
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
