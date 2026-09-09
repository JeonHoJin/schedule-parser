import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBackup } from '../src/local-storage'

function backup() {
  return {
    roster: {
      id: 'synthetic', year: 2026, month: 2,
      nurses: [{ id: 'test-person', empNo: '000001', name: 'Test', order: 0 }],
      cells: Array.from({ length: 28 }, (_, i) => ({
        nurseId: 'test-person', date: `2026-02-${String(i + 1).padStart(2, '0')}`,
        raw: '//', kind: 'OFF', flags: [], confidence: 1, edited: false,
      })),
    },
    settings: { myNurseId: 'test-person', reviewThreshold: 0.8 },
    review: { cells: [], empnos: [] },
  }
}

test('accepts legacy exports and versioned backups', () => {
  const original = backup()
  assert.equal(parseBackup(original).roster.cells.length, 28)
  assert.deepEqual(parseBackup({ version: 1, ...original }), parseBackup(original))
  assert.throws(() => parseBackup({ version: 2, ...original }))
})

test('rejects invalid dates, duplicate cells and unknown nurses', () => {
  const badDate = backup()
  badDate.roster.cells[0].date = '2026-02-29'
  assert.throws(() => parseBackup(badDate))
  const duplicate = backup()
  duplicate.roster.cells[1] = duplicate.roster.cells[0]
  assert.throws(() => parseBackup(duplicate))
  const orphan = backup()
  orphan.roster.cells[0].nurseId = 'missing'
  assert.throws(() => parseBackup(orphan))
  const unknownMe = backup()
  unknownMe.settings.myNurseId = 'missing'
  assert.throws(() => parseBackup(unknownMe))
})

test('rejects incomplete months and malformed scores', () => {
  const incomplete = backup()
  incomplete.roster.cells.pop()
  assert.throws(() => parseBackup(incomplete))
  const badScore = backup()
  badScore.roster.cells[0].confidence = Number.NaN
  assert.throws(() => parseBackup(badScore))
})

test('does not retain source-image links or unknown fields', () => {
  const original = backup()
  const data = parseBackup({ ...original, secret: 'ignored', roster: { ...original.roster, sourceImage: 'https://example.com/private.jpg' } })
  assert.equal(data.roster.sourceImage, undefined)
  assert.ok(!('secret' in data))
})
