import { GoogleGenAI, Type } from "@google/genai";
import { ClipAnalysis, VideoClip, AnalyzedSegment } from "../types";
import { buildSystemPrompt } from "../prompts/systemPrompt";

// Config
const COMPRESS_THRESHOLD_MB = 50;
const FILE_API_THRESHOLD_MB = 15;
const COMPRESSION_SERVER = 'http://localhost:3001';

// Compress video via backend
const compressVideo = async (file: File, onProgress?: (msg: string) => void): Promise<File> => {
  const sizeMB = file.size / (1024 * 1024);
  onProgress?.(`Compressing ${file.name} (${sizeMB.toFixed(0)}MB)...`);

  const formData = new FormData();
  formData.append('video', file);

  const response = await fetch(`${COMPRESSION_SERVER}/api/compress`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Compression failed');
  }

  const blob = await response.blob();
  const newSizeMB = blob.size / (1024 * 1024);
  console.log(`Compressed: ${sizeMB.toFixed(1)}MB → ${newSizeMB.toFixed(1)}MB`);
  onProgress?.(`Compressed: ${sizeMB.toFixed(0)}MB → ${newSizeMB.toFixed(0)}MB`);

  return new File([blob], file.name, { type: 'video/mp4' });
};

// Check compression server
const checkCompressionServer = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${COMPRESSION_SERVER}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

// Convert to base64
const toBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Wait for Gemini file processing
const waitForFile = async (ai: GoogleGenAI, name: string): Promise<void> => {
  let file = await ai.files.get({ name });
  while (file.state === 'PROCESSING') {
    await new Promise(r => setTimeout(r, 2000));
    file = await ai.files.get({ name });
  }
  if (file.state === 'FAILED') throw new Error('File processing failed');
};

// Schema for analysis response
const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          start: { type: Type.NUMBER },
          end: { type: Type.NUMBER },
          groupId: { type: Type.STRING },
          score: { type: Type.NUMBER },
          isBest: { type: Type.BOOLEAN }
        },
        required: ["text", "start", "end", "groupId", "score", "isBest"]
      }
    }
  },
  required: ["summary", "segments"]
};

// Ensure only one isBest per group
const enforceOneBestPerGroup = (segments: AnalyzedSegment[]): AnalyzedSegment[] => {
  const groups: Record<string, AnalyzedSegment[]> = {};

  segments.forEach(seg => {
    if (!groups[seg.groupId]) groups[seg.groupId] = [];
    groups[seg.groupId].push(seg);
  });

  Object.values(groups).forEach(groupSegs => {
    if (groupSegs.length <= 1) return;

    let bestIdx = 0;
    let bestScore = -1;
    groupSegs.forEach((seg, idx) => {
      if (seg.score > bestScore) {
        bestScore = seg.score;
        bestIdx = idx;
      }
    });

    groupSegs.forEach((seg, idx) => {
      seg.isBest = (idx === bestIdx);
    });
  });

  return segments;
};

// Validate and fix overlaps only (keep original timestamps)
const validateSegments = (segments: any[], duration: number): AnalyzedSegment[] => {
  const validSegments: AnalyzedSegment[] = [];

  // Step 1: Parse segments
  for (const seg of segments) {
    let start = Number(seg.start) || 0;
    let end = Number(seg.end) || 0;

    if (start > end) [start, end] = [end, start];
    start = Math.max(0, Math.min(start, duration));
    end = Math.max(start + 0.1, Math.min(end, duration));

    if (end - start < 0.1) continue;

    validSegments.push({
      text: seg.text || '',
      start,
      end,
      groupId: seg.groupId || 'default',
      score: Math.max(0, Math.min(100, Number(seg.score) || 50)),
      isBest: Boolean(seg.isBest)
    });
  }

  // Sort by start time
  validSegments.sort((a, b) => a.start - b.start);

  // Step 2: Fix overlaps only - adjust boundaries to make adjacent
  for (let i = 1; i < validSegments.length; i++) {
    const prev = validSegments[i - 1];
    const curr = validSegments[i];

    if (curr.start < prev.end) {
      // Overlap: use current segment's start as the boundary
      prev.end = curr.start;
      console.log(`[Fix] Overlap: seg ${i-1} end adjusted to ${curr.start.toFixed(1)}s`);
    }
  }

  return validSegments;
};

// Analyze a single clip with retry
const analyzeClip = async (
  ai: GoogleGenAI,
  clip: VideoClip,
  file: File,
  onProgress?: (msg: string) => void,
  retryCount = 0
): Promise<ClipAnalysis> => {
  const parts: any[] = [];
  let uploadedFile: string | null = null;
  const maxRetries = 2;
  const sizeMB = file.size / (1024 * 1024);

  try {
    if (sizeMB > FILE_API_THRESHOLD_MB) {
      onProgress?.(`Uploading ${clip.name}...`);

      const uploaded = await ai.files.upload({
        file,
        config: { displayName: clip.name, mimeType: 'video/mp4' }
      });

      uploadedFile = uploaded.name!;
      onProgress?.(`Processing ${clip.name}...`);
      await waitForFile(ai, uploadedFile);

      parts.push({
        fileData: { fileUri: uploaded.uri!, mimeType: 'video/mp4' }
      });
    } else {
      onProgress?.(`Encoding ${clip.name}...`);
      const base64 = await toBase64(file);

      parts.push({
        inlineData: { data: base64, mimeType: 'video/mp4' }
      });
    }

    parts.push({ text: buildSystemPrompt(clip.duration) });

    onProgress?.(`Analyzing ${clip.name}...`);
    console.log(`[Gemini] Analyzing ${clip.name} (${clip.duration}s)...`);

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema
      }
    });

    if (uploadedFile) {
      try { await ai.files.delete({ name: uploadedFile }); } catch (e) {}
    }

    const text = response.text;
    if (!text) throw new Error(`Empty response for ${clip.name}`);

    const result = JSON.parse(text);

    let validatedSegments = validateSegments(result.segments || [], clip.duration);
    validatedSegments = enforceOneBestPerGroup(validatedSegments);

    console.log(`[Gemini] ${clip.name}: ${validatedSegments.length} valid segments`);
    validatedSegments.forEach((seg, i) => {
      console.log(`  [${i}] ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s | group=${seg.groupId} | score=${seg.score} | best=${seg.isBest}`);
      console.log(`       "${seg.text.substring(0, 60)}${seg.text.length > 60 ? '...' : ''}"`);
    });

    const totalCovered = validatedSegments.reduce((acc, s) => acc + (s.end - s.start), 0);
    const coveragePercent = (totalCovered / clip.duration * 100);
    console.log(`[Gemini] Coverage: ${totalCovered.toFixed(1)}s / ${clip.duration.toFixed(1)}s (${coveragePercent.toFixed(1)}%)`);

    if (coveragePercent < 30 && clip.duration > 30) {
      console.warn(`⚠️ LOW COVERAGE WARNING: Only ${coveragePercent.toFixed(1)}% of video transcribed!`);
    }

    const groupIds = new Set(validatedSegments.map(s => s.groupId));
    const bestCount = validatedSegments.filter(s => s.isBest).length;
    console.log(`[Gemini] Groups: ${groupIds.size} | Best segments: ${bestCount}/${validatedSegments.length}`);

    return {
      summary: result.summary || '',
      segments: validatedSegments
    };

  } catch (error: any) {
    if (uploadedFile) {
      try { await ai.files.delete({ name: uploadedFile }); } catch (e) {}
    }

    if (retryCount < maxRetries) {
      console.warn(`[Gemini] Retry ${retryCount + 1}/${maxRetries} for ${clip.name}: ${error.message}`);
      await new Promise(r => setTimeout(r, 3000));
      return analyzeClip(ai, clip, file, onProgress, retryCount + 1);
    }

    throw error;
  }
};

// Main export
export const analyzeClipsWithGemini = async (
  clips: VideoClip[],
  onProgress?: (msg: string) => void
): Promise<Record<string, ClipAnalysis>> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const results: Record<string, ClipAnalysis> = {};
  const canCompress = await checkCompressionServer();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[Analysis] Starting: ${clips.length} clips`);
  console.log(`[Analysis] Compression: ${canCompress ? 'ON' : 'OFF'}`);
  console.log(`${'='.repeat(50)}`);

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const sizeMB = clip.file.size / (1024 * 1024);

    console.log(`\n--- Clip ${i + 1}/${clips.length}: ${clip.name} ---`);
    console.log(`Size: ${sizeMB.toFixed(1)}MB | Duration: ${clip.duration.toFixed(1)}s`);

    onProgress?.(`[${i + 1}/${clips.length}] ${clip.name}`);

    try {
      let fileToAnalyze = clip.file;
      if (canCompress && sizeMB > COMPRESS_THRESHOLD_MB) {
        fileToAnalyze = await compressVideo(clip.file, onProgress);
      }

      const analysis = await analyzeClip(ai, clip, fileToAnalyze, onProgress);
      results[clip.id] = analysis;

      console.log(`✓ Success: ${clip.name}`);

    } catch (error: any) {
      console.error(`✗ Failed: ${clip.name}`, error.message);
    }

    if (i < clips.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[Analysis] Done: ${Object.keys(results).length}/${clips.length} clips`);
  console.log(`${'='.repeat(50)}\n`);

  return results;
};
