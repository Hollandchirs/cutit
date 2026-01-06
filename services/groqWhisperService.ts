import { WordTimestamp } from '../types';

export interface WhisperSegment {
  text: string;
  start: number;
  end: number;
  words: WordTimestamp[];
}

export interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
}

// Groq API endpoint
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Extract audio from video and convert to blob
const extractAudioBlob = async (
  videoFile: File,
  onProgress?: (msg: string) => void
): Promise<Blob> => {
  onProgress?.('Extracting audio from video...');

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const audioContext = new AudioContext({ sampleRate: 16000 });

    video.src = URL.createObjectURL(videoFile);
    video.muted = true;

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration;
        const offlineContext = new OfflineAudioContext(1, Math.ceil(duration * 16000), 16000);

        const response = await fetch(video.src);
        const arrayBuffer = await response.arrayBuffer();

        onProgress?.('Decoding audio...');
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start();

        const renderedBuffer = await offlineContext.startRendering();
        const audioData = renderedBuffer.getChannelData(0);

        URL.revokeObjectURL(video.src);
        audioContext.close();

        // Convert Float32Array to WAV blob
        onProgress?.('Converting to WAV...');
        const wavBlob = float32ToWav(audioData, 16000);

        console.log(`[Groq] Audio extracted: ${(wavBlob.size / 1024 / 1024).toFixed(1)}MB`);
        resolve(wavBlob);
      } catch (error) {
        URL.revokeObjectURL(video.src);
        audioContext.close();
        reject(error);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Failed to load video'));
    };
  });
};

// Convert Float32Array to WAV blob
const float32ToWav = (samples: Float32Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Convert samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

// Call Groq Whisper API
export const transcribeWithGroq = async (
  videoFile: File,
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<WhisperResult> => {
  if (!apiKey) {
    throw new Error('Groq API key is required');
  }

  // Step 1: Extract audio
  const audioBlob = await extractAudioBlob(videoFile, onProgress);

  // Step 2: Call Groq API
  onProgress?.('Sending to Groq Whisper API...');
  console.log('[Groq] Calling API...');

  const startTime = Date.now();

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');
  formData.append('language', 'zh'); // Chinese

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[Groq] API error:', error);
    throw new Error(`Groq API error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Groq] Transcription completed in ${elapsed}s`);

  // Step 3: Parse result
  onProgress?.('Processing transcription...');

  // Get raw segments from Groq
  // IMPORTANT: Don't trim words to preserve all characters (e.g., "SOP" should not lose "O")
  const rawSegments: WhisperSegment[] = (result.segments || []).map((seg: any) => ({
    text: seg.text?.trim() || '',
    start: seg.start || 0,
    end: seg.end || 0,
    words: (seg.words || []).map((w: any) => ({
      // Only trim leading/trailing spaces, preserve all characters
      word: w.word ? w.word.replace(/^\s+|\s+$/g, '') : '',
      start: w.start || 0,
      end: w.end || 0,
    })),
  }));

  // If no word-level timestamps in segments, use top-level words
  if (rawSegments.length > 0 && rawSegments[0].words.length === 0 && result.words) {
    let segIdx = 0;
    for (const word of result.words) {
      while (segIdx < rawSegments.length - 1 && word.start >= rawSegments[segIdx + 1].start) {
        segIdx++;
      }
      if (segIdx < rawSegments.length) {
        rawSegments[segIdx].words.push({
          // Only trim leading/trailing spaces, preserve all characters
          word: word.word ? word.word.replace(/^\s+|\s+$/g, '') : '',
          start: word.start || 0,
          end: word.end || 0,
        });
      }
    }
  }

  // Merge small segments into larger, sentence-like chunks
  const segments = mergeSegmentsIntoSentences(rawSegments);

  console.log(`[Groq] Result: ${segments.length} segments (merged from ${rawSegments.length})`);
  segments.slice(0, 5).forEach((seg, i) => {
    console.log(`  [${i}] ${seg.start.toFixed(2)}s-${seg.end.toFixed(2)}s: "${seg.text.substring(0, 50)}..." (${seg.words.length} words)`);
  });

  onProgress?.(`Transcribed: ${segments.length} segments`);

  return {
    text: result.text || '',
    segments,
  };
};

// Merge small segments into complete sentences/paragraphs and detect silence gaps
const mergeSegmentsIntoSentences = (segments: WhisperSegment[]): WhisperSegment[] => {
  if (segments.length === 0) return [];

  const merged: WhisperSegment[] = [];
  let current: WhisperSegment | null = null;

  const MIN_SEGMENT_DURATION = 5; // Minimum 5 seconds per segment (longer = more complete sentences)
  const MAX_SEGMENT_DURATION = 20; // Maximum 20 seconds per segment
  const PAUSE_THRESHOLD = 0.8; // Gap > 0.8s indicates natural break
  const SILENCE_THRESHOLD = 0.5; // Gap > 0.5s creates a silence segment

  // Chinese sentence endings and natural break patterns
  const SENTENCE_ENDINGS = /[。！？.!?]$/;
  const SENTENCE_STARTERS = /^(然后|所以|那么|接下来|首先|其次|最后|另外|而且|但是|因为|如果|虽然|不过|总之|OK|好|嗯)/;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (!current) {
      current = { ...seg, words: [...seg.words] };
      continue;
    }

    const currentDuration = current.end - current.start;
    const wouldBeDuration = seg.end - current.start;

    // Calculate gap between current accumulated segment end and this segment start
    const gapBeforeThisSeg = seg.start - current.end;

    // Check conditions for starting a new segment
    const endsWithPunctuation = SENTENCE_ENDINGS.test(current.text);
    const thisStartsNewSentence = SENTENCE_STARTERS.test(seg.text.trim());
    const hasLongPause = gapBeforeThisSeg > PAUSE_THRESHOLD;
    const reachedMinDuration = currentDuration >= MIN_SEGMENT_DURATION;
    const wouldExceedMax = wouldBeDuration > MAX_SEGMENT_DURATION;

    // Decide whether to start a new segment
    const shouldStartNew =
      wouldExceedMax ||
      (reachedMinDuration && (endsWithPunctuation || hasLongPause || thisStartsNewSentence));

    if (shouldStartNew) {
      // Save current segment
      merged.push(current);
      
      // If there's a significant gap, create a silence segment
      if (gapBeforeThisSeg >= SILENCE_THRESHOLD) {
        merged.push({
          text: '[静音]',
          start: current.end,
          end: seg.start,
          words: []
        });
        console.log(`[Silence] Detected ${gapBeforeThisSeg.toFixed(2)}s gap at ${current.end.toFixed(2)}s-${seg.start.toFixed(2)}s`);
      }
      
      current = { ...seg, words: [...seg.words] };
    } else {
      // Merge into current
      current.text = current.text + seg.text;
      current.end = seg.end;
      current.words = [...current.words, ...seg.words];
    }
  }

  // Don't forget the last segment
  if (current) {
    merged.push(current);
  }

  // Post-process: trim silence from segment boundaries using word timestamps
  return merged.map(seg => {
    // Don't trim silence segments
    if (seg.text === '[静音]') return seg;
    return trimSegmentToWords(seg);
  });
};

// Trim segment boundaries to match actual word timestamps (remove silence padding)
// Increased padding to prevent cutting off words too early
const trimSegmentToWords = (segment: WhisperSegment): WhisperSegment => {
  if (!segment.words || segment.words.length === 0) {
    return segment;
  }

  const firstWord = segment.words[0];
  const lastWord = segment.words[segment.words.length - 1];

  // Align segment boundaries to actual word timestamps
  // Use increased padding (0.15s before first word, 0.25s after last word)
  // This ensures words aren't cut off mid-pronunciation
  const PADDING_START = 0.15; // Padding before first word starts
  const PADDING_END = 0.25;   // Padding after last word ends (words often extend beyond their timestamp)
  
  const trimmedStart = Math.max(0, firstWord.start - PADDING_START);
  const trimmedEnd = lastWord.end + PADDING_END;

  // Use the trimmed boundaries, but don't make segment shorter than word boundaries suggest
  const newStart = Math.min(segment.start, trimmedStart);
  const newEnd = Math.max(segment.end, trimmedEnd);

  if (newStart !== segment.start || newEnd !== segment.end) {
    console.log(`[Trim] "${segment.text.substring(0, 20)}..." ${segment.start.toFixed(2)}-${segment.end.toFixed(2)} → ${newStart.toFixed(2)}-${newEnd.toFixed(2)}`);
  }

  return {
    ...segment,
    start: newStart,
    end: newEnd
  };
}
