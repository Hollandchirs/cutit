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
            {/* Drag Handle */}
            <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-400 mt-0.5">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8-16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
              </svg>
            </div>

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
                {segment.isBest && (
                  <span className="text-[9px] text-yellow-400 font-semibold">
                    ★ BEST
                  </span>
                )}
                <span className={`
                  text-[9px] px-1 rounded font-mono ml-auto
                  ${segment.score >= 90 ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'}
                `}>
                  {segment.score}
                </span>
              </div>

              {/* Transcript text */}
              <p className="text-xs text-zinc-300 leading-relaxed">
                {segment.transcript || segment.name}
              </p>
            </div>

            {/* Delete Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSegment(segment.id);
              }}
              className="flex-shrink-0 p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Delete segment"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"></path>
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TranscriptView;
