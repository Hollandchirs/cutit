export interface TimeRange {
  start: number; // seconds
  end: number;   // seconds
}

export interface AnalyzedSegment {
  text: string;
  start: number;
  end: number;
  groupId: string;
  score: number;
  isBest: boolean;
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
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}