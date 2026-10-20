export { type BrowserDraft as LearningDraft, readBrowserDraft as readLearningDraft, writeBrowserDraft as writeLearningDraft, clearBrowserDraft as clearLearningDraft } from './browserDrafts'

export const learningDraftKey = (userId: string, enrollmentId: string, nodeId: string) =>
  `weblink.learning-draft:${userId}:${enrollmentId}:${nodeId}`