import { describe, expect, it } from 'vitest'
import { deriveReviewCenter } from '@/v3/selectors/reviewCenter'
import { projectCanonicalEntities } from '@/services/entityProvenance'
import { buildV3DenseVisualFixture, V3_DENSE_VISUAL_CHAPTER_COUNT } from './v3DenseVisualFixture'

describe('V3 dense visual fixture', () => {
  it('provides 64 chapters, valid planning lanes and exactly three stale reviews', () => {
    const fixture = buildV3DenseVisualFixture()
    const { novel } = fixture
    const entities = projectCanonicalEntities(novel)
    const review = deriveReviewCenter({
      novel,
      findings: [],
      candidates: fixture.candidates,
      reviews: [],
      impactReports: [],
      contextVersion: () => 'dense-visual-context',
    })

    expect(novel.chapters).toHaveLength(V3_DENSE_VISUAL_CHAPTER_COUNT)
    expect(novel.volumes).toHaveLength(4)
    expect(entities.arcs).toHaveLength(4)
    expect(entities.arcs.every(arc => arc.nodes.length === 3 && arc.nodes.every(node => node.status === 'pending'))).toBe(true)
    expect(entities.events.filter(event => event.type === '伏笔')).toHaveLength(10)
    expect(review.totals).toMatchObject({ chapters: 64, stale: 3 })
    expect(review.rows.filter(row => row.reviewStale).map(row => row.chapter.id)).toEqual(fixture.staleChapterIds)
  })
})
