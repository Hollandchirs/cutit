export interface TimeRange {
  start: number; // seconds
  end: number;   // seconds
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptWord extends WordTimestamp {
  id: string;
  text: string;
  isDeleted?: boolean;
  isFiller?: boolean;
}

export interface AnalyzedSegment {
  text: string;
  start: number;
  end: number;
  groupId: string;
  score: number;
  isBest: boolean;
  words?: WordTimestamp[];
}

export interface ClipAnalysis {
  segments: AnalyzedSegment[];
  summary: string;
}

export interface VideoClip {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: number;
  status: 'loading' | 'ready' | 'analyzing' | 'done' | 'error';
  analysis?: ClipAnalysis;
  color?: string; // Assigned color for the group
}

export interface AnalysisProgress {
  percent: number;
  message: string;
}

export interface TimelineSegment {
  id: string;
  clipId: string;
  range: TimeRange;
  isBest: boolean;
  score: number;
  color: string;
  name: string;
  transcript?: string;
  words?: WordTimestamp[];
  cuts?: TimeRange[]; // Time ranges within the segment that are cut/excluded
  isMuted?: boolean; // Whether the segment audio is muted
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}