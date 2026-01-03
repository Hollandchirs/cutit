import { VideoClip, TimelineSegment } from "../types";

const EXPORT_SERVER = 'http://localhost:3001';

export interface ExportProgress {
  stage: 'preparing' | 'uploading' | 'processing' | 'downloading' | 'done' | 'error';
  message: string;
  percent: number;
}

export const exportVideo = async (
  clips: VideoClip[],
  segments: TimelineSegment[],
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> => {
  if (segments.length === 0) {
    throw new Error('No segments to export');
  }

  // Build clip map for quick lookup
  const clipMap: Record<string, VideoClip> = {};
  clips.forEach(c => { clipMap[c.id] = c; });

  // Prepare segment data for server
  const segmentData = segments.map(seg => {
    const clip = clipMap[seg.clipId];
    if (!clip) throw new Error(`Clip not found: ${seg.clipId}`);
    return {
      fileName: clip.name,
      start: seg.range.start,
      end: seg.range.end
    };
  });

  // Get unique clips that are used in segments
  const usedClipIds = [...new Set(segments.map(s => s.clipId))];
  const usedClips = usedClipIds.map(id => clipMap[id]).filter(Boolean);

  onProgress?.({ stage: 'preparing', message: 'Preparing export...', percent: 10 });

  // Create form data
  const formData = new FormData();

  // Add video files
  for (const clip of usedClips) {
    formData.append('videos', clip.file, clip.name);
  }

  // Add segment info
  formData.append('segments', JSON.stringify(segmentData));

  onProgress?.({ stage: 'uploading', message: `Uploading ${usedClips.length} video(s)...`, percent: 20 });

  // Send to server
  const response = await fetch(`${EXPORT_SERVER}/api/export`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(error.error || 'Export failed');
  }

  onProgress?.({ stage: 'downloading', message: 'Downloading exported video...', percent: 80 });

  const blob = await response.blob();

  onProgress?.({ stage: 'done', message: 'Export complete!', percent: 100 });

  return blob;
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
