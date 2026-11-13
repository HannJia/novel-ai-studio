import type { Novel } from '@/types/novel'
import type { CanonMutationRecord } from '@/types/reconstruction'
import type { SemanticRecord } from './semanticIndex'
import { projectEventCausality, eventCausalityLabels } from './eventCausality'

/** Both direct recall and graph traversal consume ONLY this verified chapter projection. */
export function eventCausalitySemanticRecords(novel: Novel, mutations: CanonMutationRecord[], beforeChapterIndex = Infinity): SemanticRecord[] {
  return projectEventCausality(novel,mutations,beforeChapterIndex).edges.flatMap(({ revision:r,recordId }) => {
    const evidence = { id:recordId + ':quote',sourceType:'chapter' as const,sourceId:r.evidence.chapterId,
      sourceVersionId:r.evidence.sourceVersionId,quote:r.evidence.quote,startOffset:r.evidence.startOffset,endOffset:r.evidence.endOffset }
    const id = novel.id + ':event-causality:' + r.edgeId
    const title = (i: number) => String(JSON.parse(r.endpoints[i].eventSnapshot).title)
    const record: SemanticRecord = { id,novelId:novel.id,sourceType:'event',sourceId:r.edgeId,
      title:'作者确认因果：' + title(0) + ' —' + eventCausalityLabels[r.relation] + '→ ' + title(1),
      content:title(0) + ' [' + r.fromEventId + '] —' + eventCausalityLabels[r.relation] + '→ ' + title(1) + ' [' + r.toEventId + ']；' + r.explanation + '；正文证据：「' + r.evidence.quote + '」',
      metadata:{ stateKind:'event_causality',relation:r.relation,relationLabel:eventCausalityLabels[r.relation],fromEventId:r.fromEventId,toEventId:r.toEventId,
        chapterIndex:r.effectiveChapterIndex,sourceChapterId:r.evidence.chapterId,sourceVersionId:r.evidence.sourceVersionId,
        startOffset:r.evidence.startOffset,endOffset:r.evidence.endOffset,canonRecordId:recordId,evidence:[evidence] } }
    const proof: SemanticRecord = { id:id + ':evidence',novelId:novel.id,sourceType:'event',sourceId:id + ':evidence',title:record.title + ' · 原文出处',content:r.evidence.quote,
      metadata:{ stateKind:'evidence',ownerRecordId:id,chapterIndex:r.effectiveChapterIndex,sourceChapterId:r.evidence.chapterId,
        sourceVersionId:r.evidence.sourceVersionId,startOffset:r.evidence.startOffset,endOffset:r.evidence.endOffset,evidence:[evidence] } }
    return [record,proof]
  })
}
