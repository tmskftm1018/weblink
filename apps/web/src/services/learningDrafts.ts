export { type BrowserDraft as LearningDraft, readBrowserDraft as readLearningDraft, writeBrowserDraft as writeLearningDraft, clearBrowserDraft as clearLearningDraft } from './browserDrafts'

export const learningDraftKey = (userId: string, enrollmentId: string, nodeId: string) =>
  `weblink.learning-draft:${userId}:${enrollmentId}:${nodeId}`

import type { BrowserDraft } from './browserDrafts'
import type { LearningWork } from './learning'
import { compareAnswerRecovery, sameAnswers } from './answerRecovery'

export function learningSnapshot(work: LearningWork, answers: Record<string, string>, assignmentKey: string): BrowserDraft {
  return { version: work.version, baseAnswers: work.answers, answers, assignmentKey, updatedAt: new Date().toISOString() }
}

export function matchesLearningWork(draft: BrowserDraft, work: LearningWork, assignmentKey: string): boolean {
  return (!draft.assignmentKey || draft.assignmentKey === assignmentKey) && sameAnswers(draft.answers, work.answers)
}

export function compareLearningRecovery(draft: BrowserDraft, work: LearningWork) {
  return compareAnswerRecovery({ ...draft, baseAnswers: draft.baseAnswers ?? (draft.version === work.version ? work.answers : undefined) }, work.answers)
}
