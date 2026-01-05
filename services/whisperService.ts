import { pipeline, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { WordTimestamp } from '../types';

// Singleton pipeline instance
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let isLoading = false;

// Model options - smaller = faster, larger = more accurate
const MODEL_ID = 'Xenova/whisper-small'; // Good balance for Chinese + English

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

// Initialize the Whisper pipeline
export const initWhisper = async (onProgress?: (msg: string) => void): Promise<void> => {
  if (transcriber) return;
  if (isLoading) {
    // Wait for existing load
    while (isLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    return;
  }

  isLoading = true;
  onProgress?.('Loading Whisper model (first time may take a while)...');

  try {
    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      progress_callback: (progress: any) => {
        if (progress.status === 'downloading') {
          const percent = progress.progress?.toFixed(0) || 0;
          onProgress?.(`Downloading model: ${percent}%`);
        } else if (progress.status === 'loading') {
          onProgress?.('Loading model into memory...');
        }
      }
    }) as AutomaticSpeechRecognitionPipeline;

    onProgress?.('Whisper model ready');
    console.log('[Whisper] Model loaded successfully');
  } catch (error) {
    console.error('[Whisper] Failed to load model:', error);
    throw error;
  } finally {
    isLoading = false;
  }
};

// Extract audio from video file using Web Audio API
export const extractAudioFromVideo = async (
  videoFile: File,
  onProgress?: (msg: string) => void
): Promise<Float32Array> => {
  onProgress?.('Extracting audio from video...');

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const audioContext = new AudioContext({ sampleRate: 16000 }); // Whisper expects 16kHz

    video.src = URL.createObjectURL(videoFile);
    video.muted = true;

    video.onloadedmetadata = async () => {
      try {
        // Create an offline context for the full duration
        const duration = video.duration;
        const offlineContext = new OfflineAudioContext(1, Math.ceil(duration * 16000), 16000);

        // Fetch the video as array buffer
        const response = await fetch(video.src);
        const arrayBuffer = await response.arrayBuffer();

        // Decode the audio
        onProgress?.('Decoding audio...');
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Resample to 16kHz mono
        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start();

        const renderedBuffer = await offlineContext.startRendering();
        const audioData = renderedBuffer.getChannelData(0);

        URL.revokeObjectURL(video.src);
        audioContext.close();

        console.log(`[Whisper] Audio extracted: ${audioData.length} samples, ${(audioData.length / 16000).toFixed(1)}s`);
        resolve(audioData);
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

// Transcribe audio with word-level timestamps
export const transcribeAudio = async (
  audioData: Float32Array,
  onProgress?: (msg: string) => void
): Promise<WhisperResult> => {
  if (!transcriber) {
    await initWhisper(onProgress);
  }

  onProgress?.('Transcribing with Whisper...');
  console.log('[Whisper] Starting transcription...');

  const startTime = Date.now();

  // Run transcription with word-level timestamps
  // chunk_length_s and stride_length_s are required for audio > 30 seconds
  const result = await transcriber!(audioData, {
    return_timestamps: 'word',
    language: 'chinese', // Auto-detect would be 'multilingual', but Chinese is primary
    task: 'transcribe',
    chunk_length_s: 30,     // Process in 30-second chunks
    stride_length_s: 5      // 5-second overlap for continuity
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Whisper] Transcription completed in ${elapsed}s`);

  // Parse the result
  const chunks = (result as any).chunks || [];
  const fullText = (result as any).text || '';

  // Group chunks into segments (by sentence/pause)
  const segments = groupChunksIntoSegments(chunks);

  console.log(`[Whisper] Result: ${segments.length} segments, ${chunks.length} words`);
  segments.forEach((seg, i) => {
    console.log(`  [${i}] ${seg.start.toFixed(2)}s-${seg.end.toFixed(2)}s: "${seg.text.substring(0, 40)}..." (${seg.words.length} words)`);
  });

  onProgress?.(`Transcribed: ${segments.length} segments`);

  return {
    text: fullText,
    segments
  };
};

// Group word chunks into sentence-like segments
const groupChunksIntoSegments = (chunks: any[]): WhisperSegment[] => {
  if (!chunks || chunks.length === 0) return [];

  const segments: WhisperSegment[] = [];
  let currentSegment: {
    words: WordTimestamp[];
    text: string;
    start: number;
    end: number;
  } | null = null;

  const PAUSE_THRESHOLD = 0.8; // seconds - gap to start new segment
  const MAX_SEGMENT_DURATION = 15; // seconds - max segment length

  for (const chunk of chunks) {
    const word = chunk.text?.trim();
    if (!word) continue;

    const [start, end] = chunk.timestamp || [0, 0];
    if (typeof start !== 'number' || typeof end !== 'number') continue;

    const wordData: WordTimestamp = {
      word,
      start,
      end
    };

    // Check if we should start a new segment
    const shouldStartNew = !currentSegment ||
      (start - currentSegment.end > PAUSE_THRESHOLD) ||
      (start - currentSegment.start > MAX_SEGMENT_DURATION) ||
      word.match(/[。！？.!?]$/); // Sentence-ending punctuation

    if (shouldStartNew) {
      // Save previous segment
      if (currentSegment && currentSegment.words.length > 0) {
        segments.push({
          text: currentSegment.text.trim(),
          start: currentSegment.start,
          end: currentSegment.end,
          words: currentSegment.words
        });
      }

      // Start new segment
      currentSegment = {
        words: [wordData],
        text: word,
        start,
        end
      };
    } else {
      // Add to current segment
      currentSegment.words.push(wordData);
      currentSegment.text += word;
      currentSegment.end = end;
    }
  }

  // Don't forget the last segment
  if (currentSegment && currentSegment.words.length > 0) {
    segments.push({
      text: currentSegment.text.trim(),
      start: currentSegment.start,
      end: currentSegment.end,
      words: currentSegment.words
    });
  }

  return segments;
};

// Main function: transcribe a video file
export const transcribeVideoWithWhisper = async (
  videoFile: File,
  onProgress?: (msg: string) => void
): Promise<WhisperResult> => {
  // Step 1: Extract audio
  const audioData = await extractAudioFromVideo(videoFile, onProgress);

  // Step 2: Transcribe
  const result = await transcribeAudio(audioData, onProgress);

  return result;
};
