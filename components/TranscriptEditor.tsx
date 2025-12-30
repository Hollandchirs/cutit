import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { TimelineSegment, TranscriptWord } from '../types';

// Common filler words in Chinese and English
const FILLER_WORDS = new Set([
  // Chinese
  '嗯', '啊', '呃', '额', '那个', '就是', '然后', '对吧', '是吧', '这个', '所以说',
  // English
  'um', 'uh', 'like', 'you know', 'so', 'basically', 'actually', 'literally',
]);

interface TranscriptEditorProps {
  segments: TimelineSegment[];
  currentTime: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onUpdateSegmentWords: (segmentId: string, words: TranscriptWord[]) => void;
  onDeleteSegment: (segmentId: string) => void;
}

// Generate word-level data from transcript text
const generateWordsFromTranscript = (
  transcript: string,
  segmentStart: number,
  segmentEnd: number,
  segmentId: string
): TranscriptWord[] => {
  if (!transcript) return [];

  // Split by spaces and punctuation, keeping the text
  const rawWords = transcript.split(/(\s+)/).filter(w => w.trim());
  const duration = segmentEnd - segmentStart;
  const wordDuration = duration / rawWords.length;

  return rawWords.map((text, i) => {
    const cleanText = text.toLowerCase().replace(/[.,!?，。！？]/g, '');
    return {
      id: `${segmentId}-word-${i}`,
      text,
      start: segmentStart + i * wordDuration,
      end: segmentStart + (i + 1) * wordDuration,
      isDeleted: false,
      isFiller: FILLER_WORDS.has(cleanText),
    };
  });
};

const TranscriptEditor: React.FC<TranscriptEditorProps> = ({
  segments,
  currentTime,
  isPlaying,
  onSeek,
  onUpdateSegmentWords,
  onDeleteSegment,
}) => {
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);

  // Generate words for all segments
  const allWords = useMemo(() => {
    return segments.flatMap(seg => {
      if (seg.words && seg.words.length > 0) {
        return seg.words.map(w => ({ ...w, segmentId: seg.id, color: seg.color }));
      }
      // Generate from transcript if no word-level data
      return generateWordsFromTranscript(
        seg.transcript || '',
        seg.range.start,
        seg.range.end,
        seg.id
      ).map(w => ({ ...w, segmentId: seg.id, color: seg.color }));
    });
  }, [segments]);

  // Find currently playing word
  const currentWordId = useMemo(() => {
    for (const word of allWords) {
      if (currentTime >= word.start && currentTime < word.end && !word.isDeleted) {
        return word.id;
      }
    }
    return null;
  }, [allWords, currentTime]);

  // Auto-scroll to current word
  useEffect(() => {
    if (isPlaying && activeWordRef.current && containerRef.current) {
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentWordId, isPlaying]);

  // Handle word click
  const handleWordClick = useCallback((word: typeof allWords[0], e: React.MouseEvent) => {
    e.stopPropagation();

    if (e.shiftKey && selectionStart) {
      // Range selection
      const startIdx = allWords.findIndex(w => w.id === selectionStart);
      const endIdx = allWords.findIndex(w => w.id === word.id);
      const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];

      const newSelection = new Set<string>();
      for (let i = from; i <= to; i++) {
        newSelection.add(allWords[i].id);
      }
      setSelectedWords(newSelection);
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle selection
      const newSelection = new Set(selectedWords);
      if (newSelection.has(word.id)) {
        newSelection.delete(word.id);
      } else {
        newSelection.add(word.id);
      }
      setSelectedWords(newSelection);
      setSelectionStart(word.id);
    } else {
      // Single selection + seek
      setSelectedWords(new Set([word.id]));
      setSelectionStart(word.id);
      onSeek(word.start);
    }
  }, [allWords, selectedWords, selectionStart, onSeek]);

  // Handle mouse down for drag selection
  const handleMouseDown = useCallback((word: typeof allWords[0], e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsSelecting(true);
    setSelectionStart(word.id);
    setSelectedWords(new Set([word.id]));
  }, []);

  // Handle mouse enter during selection
  const handleMouseEnter = useCallback((word: typeof allWords[0]) => {
    if (!isSelecting || !selectionStart) return;

    const startIdx = allWords.findIndex(w => w.id === selectionStart);
    const endIdx = allWords.findIndex(w => w.id === word.id);
    const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];

    const newSelection = new Set<string>();
    for (let i = from; i <= to; i++) {
      newSelection.add(allWords[i].id);
    }
    setSelectedWords(newSelection);
  }, [isSelecting, selectionStart, allWords]);

  // Global mouse up
  useEffect(() => {
    const handleMouseUp = () => setIsSelecting(false);
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Handle delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWords.size > 0) {
        e.preventDefault();

        // Mark selected words as deleted
        const wordsBySegment = new Map<string, TranscriptWord[]>();

        segments.forEach(seg => {
          const segWords = (seg.words || generateWordsFromTranscript(
            seg.transcript || '',
            seg.range.start,
            seg.range.end,
            seg.id
          )).map(w => ({
            ...w,
            isDeleted: selectedWords.has(w.id) ? true : w.isDeleted,
          }));
          wordsBySegment.set(seg.id, segWords);
        });

        wordsBySegment.forEach((words, segmentId) => {
          onUpdateSegmentWords(segmentId, words);
        });

        setSelectedWords(new Set());
      }

      // Escape to clear selection
      if (e.key === 'Escape') {
        setSelectedWords(new Set());
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedWords, segments, onUpdateSegmentWords]);

  // Auto-remove filler words
  const handleRemoveFillers = useCallback(() => {
    segments.forEach(seg => {
      const segWords = (seg.words || generateWordsFromTranscript(
        seg.transcript || '',
        seg.range.start,
        seg.range.end,
        seg.id
      )).map(w => ({
        ...w,
        isDeleted: w.isFiller ? true : w.isDeleted,
      }));
      onUpdateSegmentWords(seg.id, segWords);
    });
  }, [segments, onUpdateSegmentWords]);

  // Restore all words
  const handleRestoreAll = useCallback(() => {
    segments.forEach(seg => {
      const segWords = (seg.words || generateWordsFromTranscript(
        seg.transcript || '',
        seg.range.start,
        seg.range.end,
        seg.id
      )).map(w => ({
        ...w,
        isDeleted: false,
      }));
      onUpdateSegmentWords(seg.id, segWords);
    });
  }, [segments, onUpdateSegmentWords]);

  // Count stats
  const stats = useMemo(() => {
    const total = allWords.length;
    const deleted = allWords.filter(w => w.isDeleted).length;
    const fillers = allWords.filter(w => w.isFiller && !w.isDeleted).length;
    return { total, deleted, fillers };
  }, [allWords]);

  // Group words by segment for display
  const segmentGroups = useMemo(() => {
    const groups: { segment: TimelineSegment; words: typeof allWords }[] = [];
    let currentSegmentId = '';
    let currentGroup: typeof allWords = [];

    allWords.forEach(word => {
      if (word.segmentId !== currentSegmentId) {
        if (currentGroup.length > 0) {
          const seg = segments.find(s => s.id === currentSegmentId);
          if (seg) groups.push({ segment: seg, words: currentGroup });
        }
        currentSegmentId = word.segmentId;
        currentGroup = [word];
      } else {
        currentGroup.push(word);
      }
    });

    if (currentGroup.length > 0) {
      const seg = segments.find(s => s.id === currentSegmentId);
      if (seg) groups.push({ segment: seg, words: currentGroup });
    }

    return groups;
  }, [allWords, segments]);

  if (segments.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="text-4xl mb-4">📝</div>
          <p>No transcript available yet</p>
          <p className="text-sm text-zinc-600 mt-2">Import videos and run Smart Cut first</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-zinc-300">Transcript Editor</span>
          <div className="text-xs text-zinc-500">
            {stats.total} words · {stats.deleted} removed · {stats.fillers} fillers
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRemoveFillers}
            className="px-3 py-1.5 text-xs bg-amber-600/20 text-amber-400 rounded hover:bg-amber-600/30 transition flex items-center gap-1.5"
          >
            <span>🧹</span>
            Remove Fillers
          </button>
          <button
            onClick={handleRestoreAll}
            className="px-3 py-1.5 text-xs bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition"
          >
            Restore All
          </button>
        </div>
      </div>

      {/* Help bar */}
      <div className="h-8 border-b border-zinc-800/50 flex items-center px-4 bg-zinc-900/50 text-[11px] text-zinc-500 gap-6">
        <span>Click word to seek</span>
        <span>Shift+Click to select range</span>
        <span>Delete/Backspace to remove</span>
        <span>Drag to select multiple</span>
      </div>

      {/* Transcript Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-6 custom-scrollbar"
        onClick={() => setSelectedWords(new Set())}
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {segmentGroups.map(({ segment, words }) => (
            <div key={segment.id} className="group">
              {/* Segment header */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="text-[10px] text-zinc-500 font-mono">
                  {segment.name}
                </span>
                {segment.isBest && (
                  <span className="text-[10px] text-yellow-500">★ Best Take</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSegment(segment.id);
                  }}
                  className="ml-auto opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs transition"
                >
                  Delete Segment
                </button>
              </div>

              {/* Words */}
              <div className="leading-relaxed text-lg">
                {words.map((word) => (
                  <span
                    key={word.id}
                    ref={currentWordId === word.id ? activeWordRef : null}
                    onClick={(e) => handleWordClick(word, e)}
                    onMouseDown={(e) => handleMouseDown(word, e)}
                    onMouseEnter={() => handleMouseEnter(word)}
                    className={`
                      inline cursor-pointer transition-all duration-150 rounded px-0.5 mx-0.5
                      ${word.isDeleted
                        ? 'line-through text-zinc-600 bg-zinc-800/50 opacity-50'
                        : word.isFiller
                          ? 'text-amber-400/80 bg-amber-500/10'
                          : 'text-zinc-200 hover:bg-zinc-800'
                      }
                      ${selectedWords.has(word.id)
                        ? 'bg-blue-600/40 text-white ring-1 ring-blue-500'
                        : ''
                      }
                      ${currentWordId === word.id && !word.isDeleted
                        ? 'bg-green-600/30 text-green-300 ring-1 ring-green-500'
                        : ''
                      }
                    `}
                    title={word.isFiller ? 'Filler word' : undefined}
                  >
                    {word.text}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selection bar */}
      {selectedWords.size > 0 && (
        <div className="h-12 border-t border-zinc-800 flex items-center justify-center gap-4 bg-blue-950/50 shrink-0">
          <span className="text-sm text-blue-300">
            {selectedWords.size} word{selectedWords.size > 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => {
              // Mark as deleted
              segments.forEach(seg => {
                const segWords = (seg.words || generateWordsFromTranscript(
                  seg.transcript || '',
                  seg.range.start,
                  seg.range.end,
                  seg.id
                )).map(w => ({
                  ...w,
                  isDeleted: selectedWords.has(w.id) ? true : w.isDeleted,
                }));
                onUpdateSegmentWords(seg.id, segWords);
              });
              setSelectedWords(new Set());
            }}
            className="px-4 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-500 transition flex items-center gap-2"
          >
            <span>🗑</span>
            Delete Selected
          </button>
          <button
            onClick={() => setSelectedWords(new Set())}
            className="px-4 py-1.5 bg-zinc-700 text-zinc-300 text-sm rounded hover:bg-zinc-600 transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default TranscriptEditor;
