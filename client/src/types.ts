/** Oxbridge Ledger: strict public-data and exercise-state contracts for the editorial learning experience. */
export interface ReleaseQuestion {
  id: string;
  headword: string;
  /** Existing master `pos_raw` label; public-safe display metadata, not provenance. */
  partOfSpeech: string;
  collectionId: string;
  segmentId: string;
  question: string;
  answer: string;
  distractors: [string, string, string];
  definition: string;
  optionDefinitions: Record<string, string>;
}

export interface SegmentRelease {
  schemaVersion: number;
  releaseVersion: string;
  collectionId: string;
  segmentId: string;
  questions: ReleaseQuestion[];
}

export interface SegmentCatalogueItem {
  id: string;
  label: string;
  rangeStart: number;
  rangeEnd: number;
  firstHeadword: string;
  lastHeadword: string;
  availableCount: number;
  dataFile: string;
}

export interface CollectionCatalogueItem {
  id: string;
  label: string;
  cefrLevel: string;
  segments: [SegmentCatalogueItem, SegmentCatalogueItem];
}

export interface ReleaseCatalogue {
  schemaVersion: number;
  releaseVersion: string;
  generatedAtUtc: string;
  definitionLanguage: "zh-Hant";
  releasedQuestionCount: number;
  collections: CollectionCatalogueItem[];
}

export type SegmentMode = string | "full";

export interface ExerciseSelection {
  collectionId: string;
  collectionLabel: string;
  cefrLevel: string;
  segmentMode: SegmentMode;
  segmentLabel: string;
  rangeLabel: string;
  requestedCount: number;
}

export interface ExerciseQuestion extends ReleaseQuestion {
  options: string[];
}

export interface QuestionProgress {
  attemptedOptions: string[];
  lastSelectedOption: string | null;
  resolved: boolean;
  firstAttemptCorrect: boolean;
}

export interface ExerciseSnapshot {
  schemaVersion: 2;
  releaseVersion: string;
  sessionId: string;
  status: "active" | "complete";
  selection: ExerciseSelection;
  questions: ExerciseQuestion[];
  questionProgress: QuestionProgress[];
  currentIndex: number;
  score: number;
  elapsedMs: number;
  savedAtUtc: string;
}
