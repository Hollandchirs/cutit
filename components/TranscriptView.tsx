import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { TimelineSegment, WordTimestamp } from '../types';

interface TranscriptViewProps {
  segments: TimelineSegment[];
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  onDeleteSegment: (id: string) => void;
  onReorderSegments: (fromIndex: number, toIndex: number) => void;
  onSeek?: (time: number) => void;
  onCutWords?: (segmentId: string, cutStart: number, cutEnd: number) => void;
  onToggleMute?: (id: string) => void;
  currentTime?: number; // Current playback time for word following
  isPlaying?: boolean;
}

const TranscriptView: React.FC<TranscriptViewProps> = ({
  segments,
  selectedSegmentId,
  onSelectSegment,
  onDeleteSegment,
  onReorderSegments,
  onSeek,
  onCutWords,
  onToggleMute,
  currentTime = 0,
  isPlaying = false
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [wordSelectionStart, setWordSelectionStart] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef<number | null>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);

  // Auto-scroll to active word during playback
  useEffect(() => {
    if (isPlaying && activeWordRef.current && containerRef.current) {
      activeWordRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentTime, isPlaying]);

  // Auto-scroll during drag
  const handleDragAutoScroll = useCallback((e: React.DragEvent) => {
    if (!containerRef.current || dragIndex === null) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const scrollZone = 60;
    const scrollSpeed = 8;

    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }

    if (mouseY < scrollZone) {
      const scroll = () => {
        if (container.scrollTop > 0) {
          container.scrollTop -= scrollSpeed;
          autoScrollRef.current = requestAnimationFrame(scroll);
        }
      };
      autoScrollRef.current = requestAnimationFrame(scroll);
    } else if (mouseY > rect.height - scrollZone) {
      const scroll = () => {
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (container.scrollTop < maxScroll) {
          container.scrollTop += scrollSpeed;
          autoScrollRef.current = requestAnimationFrame(scroll);
        }
      };
      autoScrollRef.current = requestAnimationFrame(scroll);
    }
  }, [dragIndex]);

  useEffect(() => {
    return () => {
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current);
      }
    };
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex !== null && dragIndex !== index) {
      setDropTargetIndex(index);
    }
  }, [dragIndex]);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dropTargetIndex !== null && dragIndex !== dropTargetIndex) {
      onReorderSegments(dragIndex, dropTargetIndex);
    }
    setDragIndex(null);
    setDropTargetIndex(null);
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, [dragIndex, dropTargetIndex, onReorderSegments]);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate timeline position for a segment
  const getTimelinePosition = useCallback((index: number) => {
    let accumulated = 0;
    for (let i = 0; i < index; i++) {
      accumulated += segments[i].range.end - segments[i].range.start;
    }
    return accumulated;
  }, [segments]);

  // Handle segment click
  const handleSegmentClick = useCallback((segment: TimelineSegment, index: number, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('word-span')) return;
    onSelectSegment(segment.id);
    setSelectedWordIds(new Set());
    if (onSeek) {
      const timelinePos = getTimelinePosition(index);
      onSeek(timelinePos);
    }
  }, [onSelectSegment, onSeek, getTimelinePosition]);

  // Generate words from segment
  const getSegmentWords = useCallback((segment: TimelineSegment): (WordTimestamp & { id: string })[] => {
    if (segment.words && segment.words.length > 0) {
      return segment.words.map((w, i) => ({ ...w, id: `${segment.id}-w${i}` }));
    }
    const transcript = segment.transcript || '';
    const rawWords = transcript.split(/(\s+)/).filter(w => w.trim());
    const duration = segment.range.end - segment.range.start;
    const wordDuration = rawWords.length > 0 ? duration / rawWords.length : 0;

    return rawWords.map((text, i) => ({
      id: `${segment.id}-w${i}`,
      word: text,
      start: segment.range.start + i * wordDuration,
      end: segment.range.start + (i + 1) * wordDuration,
    }));
  }, []);

  // Find current word based on playback time
  const getCurrentWordId = useCallback((segment: TimelineSegment, words: (WordTimestamp & { id: string })[]) => {
    // Check if current time is within this segment
    if (currentTime < segment.range.start || currentTime > segment.range.end) {
      return null;
    }
    for (const word of words) {
      if (currentTime >= word.start && currentTime < word.end) {
        return word.id;
      }
    }
    return null;
  }, [currentTime]);

  // Handle word click for selection
  const handleWordClick = useCallback((wordId: string, words: (WordTimestamp & { id: string })[], e: React.MouseEvent) => {
    e.stopPropagation();

    if (e.shiftKey && wordSelectionStart) {
      const startIdx = words.findIndex(w => w.id === wordSelectionStart);
      const endIdx = words.findIndex(w => w.id === wordId);
      const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];

      const newSelection = new Set<string>();
      for (let i = from; i <= to; i++) {
        newSelection.add(words[i].id);
      }
      setSelectedWordIds(newSelection);
    } else if (e.metaKey || e.ctrlKey) {
      const newSelection = new Set(selectedWordIds);
      if (newSelection.has(wordId)) {
        newSelection.delete(wordId);
      } else {
        newSelection.add(wordId);
      }
      setSelectedWordIds(newSelection);
      setWordSelectionStart(wordId);
    } else {
      setSelectedWordIds(new Set([wordId]));
      setWordSelectionStart(wordId);
    }
  }, [selectedWordIds, wordSelectionStart]);

  // Handle cut words
  const handleCutSelectedWords = useCallback((segment: TimelineSegment, words: (WordTimestamp & { id: string })[]) => {
    if (!onCutWords || selectedWordIds.size === 0) return;

    const selectedWords = words.filter(w => selectedWordIds.has(w.id));
    if (selectedWords.length === 0) return;

    const cutStart = Math.min(...selectedWords.map(w => w.start));
    const cutEnd = Math.max(...selectedWords.map(w => w.end));

    onCutWords(segment.id, cutStart, cutEnd);
    setSelectedWordIds(new Set());
  }, [onCutWords, selectedWordIds]);

  if (segments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs p-4">
        <p className="text-center">
          No transcript yet.<br />
          Upload videos and click "Smart Cut" to generate.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-2 space-y-1"
      onDragOver={handleDragAutoScroll}
    >
      {/* Drop zone for moving to top */}
      {dragIndex !== null && dragIndex > 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropTargetIndex(0);
          }}
          onDragLeave={() => setDropTargetIndex(null)}
          className={`h-8 mb-1 rounded-md border-2 border-dashed transition-colors flex items-center justify-center text-[10px] ${
            dropTargetIndex === 0
              ? 'border-blue-500 bg-blue-500/20 text-blue-400'
              : 'border-zinc-700 text-zinc-600 hover:border-zinc-600'
          }`}
        >
          Drop here to move to top
        </div>
      )}
      {segments.map((segment, index) => {
        const isSelected = selectedSegmentId === segment.id;
        const words = getSegmentWords(segment);
        const currentWordId = getCurrentWordId(segment, words);
        const hasSelectedWords = selectedWordIds.size > 0;

        return (
          <div
            key={segment.id}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            onClick={(e) => handleSegmentClick(segment, index, e)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (onToggleMute) onToggleMute(segment.id);
            }}
            className={`
              relative group rounded-md transition-all cursor-pointer
              ${isSelected
                ? 'bg-zinc-800 ring-1 ring-blue-500/50'
                : 'hover:bg-zinc-800/50'
              }
              ${dragIndex === index ? 'opacity-50' : ''}
              ${dropTargetIndex === index ? 'border-t-2 border-blue-500' : ''}
              ${segment.isMuted ? 'opacity-40' : ''}
            `}
          >
            <div className="flex items-start gap-2 p-2">
              {/* Icon - Scissors for muted/retake, Drag Handle for best */}
              {segment.isMuted ? (
                <div className="flex-shrink-0 text-zinc-500 mt-0.5" title="Cut - double-click to restore">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/>
                  </svg>
                </div>
              ) : !segment.isBest ? (
                <div className="flex-shrink-0 text-zinc-500 mt-0.5" title="Retake - double-click to cut">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/>
                  </svg>
                </div>
              ) : (
                <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 mt-0.5" title="Double-click to cut">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8-16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                  </svg>
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {formatTime(segment.range.start)} - {formatTime(segment.range.end)}
                  </span>
                </div>

                {/* Transcript text with real-time word highlighting - NO exploding effect */}
                <div className="relative">
                  <p className={`text-xs leading-relaxed ${
                    segment.isBest && !segment.isMuted
                      ? 'text-zinc-300'
                      : 'text-zinc-500 line-through decoration-zinc-500'
                  }`}>
                    {words.map((word, wordIndex) => {
                      const isCurrentWord = currentWordId === word.id;
                      const isWordSelected = selectedWordIds.has(word.id);
                      // Check if this is the last selected word to show scissors
                      const selectedWordsList = words.filter(w => selectedWordIds.has(w.id));
                      const isLastSelectedWord = selectedWordsList.length > 0 &&
                        selectedWordsList[selectedWordsList.length - 1].id === word.id;

                      return (
                        <span
                          key={word.id}
                          ref={isCurrentWord ? activeWordRef : null}
                          onClick={(e) => handleWordClick(word.id, words, e)}
                          className={`word-span inline cursor-pointer transition-all ${
                            isCurrentWord
                              ? 'text-green-400 font-medium'
                              : isWordSelected
                                ? 'bg-blue-600/40 text-white rounded px-0.5'
                                : ''
                          }`}
                        >
                          {word.word}
                          {wordIndex < words.length - 1 ? ' ' : ''}
                          {/* Fixed scissors button after last selected word */}
                          {isLastSelectedWord && onCutWords && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCutSelectedWords(segment, words);
                              }}
                              className="inline-flex items-center justify-center ml-1 p-1 bg-blue-600 text-white rounded shadow-lg hover:bg-blue-500 align-middle"
                              title="剪切选中"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/>
                              </svg>
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TranscriptView;
