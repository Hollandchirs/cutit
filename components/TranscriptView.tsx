import React, { useState, useCallback } from 'react';
import { TimelineSegment } from '../types';

interface TranscriptViewProps {
  segments: TimelineSegment[];
  selectedSegmentId: string | null;
  onSelectSegment: (id: string | null) => void;
  onDeleteSegment: (id: string) => void;
  onReorderSegments: (fromIndex: number, toIndex: number) => void;
}

const TranscriptView: React.FC<TranscriptViewProps> = ({
  segments,
  selectedSegmentId,
  onSelectSegment,
  onDeleteSegment,
  onReorderSegments
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

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
  }, [dragIndex, dropTargetIndex, onReorderSegments]);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {segments.map((segment, index) => (
        <div
          key={segment.id}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragEnd={handleDragEnd}
          onDragLeave={handleDragLeave}
          onClick={() => onSelectSegment(segment.id)}
          className={`
            relative group rounded-md transition-all cursor-pointer
            ${selectedSegmentId === segment.id
              ? 'bg-zinc-800 ring-1 ring-blue-500/50'
              : 'hover:bg-zinc-800/50'
            }
            ${dragIndex === index ? 'opacity-50' : ''}
            ${dropTargetIndex === index ? 'border-t-2 border-blue-500' : ''}
          `}
        >
          <div className="flex items-start gap-2 p-2">
            {/* Scissors Icon - for non-best (retake) segments */}
            {!segment.isBest ? (
              <div className="flex-shrink-0 text-zinc-500 mt-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/>
                </svg>
              </div>
            ) : (
              /* Drag Handle - for best segments */
              <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 mt-0.5">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8-16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                </svg>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Header row - only show time for best segments */}
              {segment.isBest && (
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {formatTime(segment.range.start)} - {formatTime(segment.range.end)}
                  </span>
                </div>
              )}

              {/* Transcript text - strikethrough for non-best */}
              <p className={`text-xs leading-relaxed ${
                segment.isBest
                  ? 'text-zinc-300'
                  : 'text-zinc-500 line-through decoration-zinc-500'
              }`}>
                {segment.transcript || segment.name}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TranscriptView;
