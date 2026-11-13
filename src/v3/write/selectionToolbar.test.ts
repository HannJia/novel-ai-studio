import { expect, it } from 'vitest'
import { placeSelectionToolbar } from './selectionToolbar'
const bounds = { left: 364, right: 884, top: 60, bottom: 862 }
it('centers the compact toolbar while keeping it inside the writing column', () => {
  expect(placeSelectionToolbar({ left: 790, right: 880, top: 300, bottom: 330 }, bounds, { width: 368, height: 40 }))
    .toEqual({ maxWidth: '520px', left: '516px', top: '250px' })
})
it('places a wrapped narrow toolbar below a selection near the top', () => {
  expect(placeSelectionToolbar({ left: 100, right: 200, top: 70, bottom: 100 }, { left: 90, right: 350, top: 60, bottom: 862 }, { width: 260, height: 78 }))
    .toEqual({ maxWidth: '260px', left: '90px', top: '110px' })
})
