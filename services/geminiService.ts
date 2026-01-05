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
          isBest: { type: Type.BOOLEAN },
          words: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER }
              },
              required: ["word", "start", "end"]
            }
          }
        },
        required: ["text", "start", "end", "groupId", "score", "isBest", "words"]
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

// Validate and fix overlaps, align segment boundaries with word timestamps
const validateSegments = (segments: any[], duration: number): AnalyzedSegment[] => {
  const validSegments: AnalyzedSegment[] = [];

  // Step 1: Parse segments and align with word timestamps
  for (const seg of segments) {
    let start = Number(seg.start) || 0;
    let end = Number(seg.end) || 0;
    const words = seg.words || [];

    // Align segment boundaries with word timestamps if words exist
    if (words.length > 0) {
      const firstWord = words[0];
      const lastWord = words[words.length - 1];

      // Use word timestamps for precise boundaries
      if (firstWord && typeof firstWord.start === 'number') {
        start = firstWord.start;
      }
      if (lastWord && typeof lastWord.end === 'number') {
        end = lastWord.end;
      }

      console.log(`[Validate] Segment "${seg.text?.substring(0, 20)}..." aligned to words: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
    }

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
      isBest: Boolean(seg.isBest),
      words: words  // Keep word-level timestamps!
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
      model: 'gemini-3-flash-preview',
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
      const wordCount = seg.words?.length || 0;
      console.log(`  [${i}] ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s | group=${seg.groupId} | score=${seg.score} | best=${seg.isBest} | words=${wordCount}`);
      console.log(`       "${seg.text.substring(0, 60)}${seg.text.length > 60 ? '...' : ''}"`);
      if (wordCount > 0 && seg.words) {
        console.log(`       First 3 words: ${seg.words.slice(0, 3).map(w => `"${w.word}"@${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join(', ')}`);
      }
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

// Build analysis prompt based on systemPrompt.ts logic
const buildAnalysisPrompt = (segments: Array<{ text: string; start: number; end: number }>) => {
  const segmentList = segments.map((seg, i) =>
    `[${i}] ${seg.start.toFixed(1)}s-${seg.end.toFixed(1)}s: "${seg.text}"`
  ).join('\n');

  return `你是一个专业的视频剪辑AI，负责分析转录文本并识别重复内容。

## 转录片段
${segmentList}

## 重复片段识别规则

### 什么是重复片段？
- 说话人说了一句话，停下来，然后重新说**同样的内容**
- 这是录制视频时的"重录"或"NG镜头"

### 如何判断重复：
- 两个片段**开头相同**或**内容相似** → 是重复 → 相同groupId
- 两个片段**内容完全不同** → 不是重复 → 不同groupId

### 评分标准：
- 完整流畅的表达 → score 80-100, isBest=true
- 说到一半停了/有口误 → score 40-70, isBest=false
- 每组重复中只有一个isBest=true（选最完整的那个）

## 判断示例

### 示例1: 开头重录
- 片段A: "大家好，我是...呃..."
- 片段B: "大家好，我是小明，今天介绍AI"
判断: 开头相同"大家好，我是" → 重录 → 同groupId
结果: A → groupId="g1", score=40, isBest=false
      B → groupId="g1", score=90, isBest=true

### 示例2: 同一句话说了3次
- 片段A: "那么这个..."
- 片段B: "那么这个产品..."
- 片段C: "那么这个产品的核心优势是什么呢"
判断: 都以"那么这个"开头 → 3次重录 → 同groupId
结果: A,B → isBest=false, C → isBest=true

### 示例3: 不同内容（不是重录）
- 片段A: "首先我们来看界面设计"
- 片段B: "然后是核心功能介绍"
判断: 内容不同 → 不是重录 → 不同groupId
结果: A → groupId="g1", B → groupId="g2", 都是isBest=true

### 示例4: 相似主题但不同内容
- 片段A: "AI可以生成海报"
- 片段B: "AI还可以生成视频"
判断: "海报"和"视频"是不同功能 → 不是重录 → 不同groupId

## 输出格式

请为每个片段输出分析结果:
{
  "results": [
    {"index": 0, "groupId": "g1", "score": 90, "isBest": true},
    {"index": 1, "groupId": "g1", "score": 50, "isBest": false},
    {"index": 2, "groupId": "g2", "score": 85, "isBest": true}
  ]
}

注意:
- index对应上面片段的序号[0], [1], [2]...
- groupId格式: g1, g2, g3... (重复内容用相同groupId)
- 每个groupId组内只有一个isBest=true

只输出JSON，不要其他内容。`;
};

// Analyze transcript with Gemini (text-only, much faster than video)
export const analyzeTranscriptWithGemini = async (
  transcript: { text: string; segments: Array<{ text: string; start: number; end: number; words: Array<{ word: string; start: number; end: number }> }> },
  duration: number,
  onProgress?: (msg: string) => void
): Promise<ClipAnalysis> => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  onProgress?.('Analyzing with Gemini AI...');
  console.log(`[Gemini] Analyzing transcript (${transcript.segments.length} segments)...`);

  const prompt = buildAnalysisPrompt(transcript.segments);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json"
      }
    });

    const text = response.text;
    if (!text) throw new Error('Empty response from Gemini');

    console.log('[Gemini] Raw response:', text.substring(0, 500));

    const result = JSON.parse(text);
    const analysisResults = result.results || [];

    // Merge Gemini analysis with original segments
    const mergedSegments: AnalyzedSegment[] = transcript.segments.map((seg, i) => {
      const analysis = analysisResults.find((r: any) => r.index === i) || {
        groupId: `g${i}`,
        score: 80,
        isBest: true
      };

      return {
        text: seg.text,
        start: seg.start,
        end: seg.end,
        groupId: analysis.groupId || `g${i}`,
        score: analysis.score || 80,
        isBest: analysis.isBest !== false,
        words: seg.words || []
      };
    });

    // Ensure one best per group
    const finalSegments = enforceOneBestPerGroup(mergedSegments);

    // Log results
    const groups = new Set(finalSegments.map(s => s.groupId));
    const duplicates = finalSegments.filter(s => !s.isBest).length;
    console.log(`[Gemini] Analysis complete: ${finalSegments.length} segments, ${groups.size} groups, ${duplicates} duplicates`);

    finalSegments.forEach((seg, i) => {
      if (!seg.isBest) {
        console.log(`  [Duplicate] "${seg.text.substring(0, 30)}..." (group: ${seg.groupId}, score: ${seg.score})`);
      }
    });

    onProgress?.(`Found ${duplicates} duplicate segments`);

    return {
      summary: transcript.text.substring(0, 200),
      segments: finalSegments
    };

  } catch (error: any) {
    console.error('[Gemini] Analysis failed:', error.message);
    console.error(error);

    // Fallback: return original segments without analysis
    console.log('[Gemini] Falling back to simple analysis...');
    onProgress?.('Using simple analysis...');

    const fallbackSegments: AnalyzedSegment[] = transcript.segments.map((seg, i) => ({
      text: seg.text,
      start: seg.start,
      end: seg.end,
      groupId: `g${i}`,
      score: 80,
      isBest: true,
      words: seg.words || []
    }));

    // Simple duplicate detection fallback
    for (let i = 0; i < fallbackSegments.length; i++) {
      for (let j = i + 1; j < fallbackSegments.length; j++) {
        const textA = fallbackSegments[i].text.replace(/[，。！？、\s]/g, '');
        const textB = fallbackSegments[j].text.replace(/[，。！？、\s]/g, '');

        // Check if texts are similar (share >50% characters)
        const setA = new Set(textA);
        const setB = new Set(textB);
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const similarity = intersection / Math.max(setA.size, setB.size);

        if (similarity > 0.6) {
          fallbackSegments[j].groupId = fallbackSegments[i].groupId;
          fallbackSegments[j].isBest = false;
          fallbackSegments[j].score = 60;
        }
      }
    }

    return {
      summary: transcript.text.substring(0, 200),
      segments: fallbackSegments
    };
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
