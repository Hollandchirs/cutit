import React, { useMemo, useRef, useState, useCallback } from 'react';
import { TimelineSegment } from '../types';

interface TimelineProps {
  segments: TimelineSegment[];
  currentTime: number;
  totalDuration: number;
  zoomLevel: number;
  selectedSegmentId: string | null;
  onSeek: (time: number) => void;
  onSelectSegment: (id: string | null) => void;
  onReorderSegments: (fromIndex: number, toIndex: number) => void;
  onResizeSegment: (id: string, newStart: number, newEnd: number) => void;
}

const Timeline: React.FC<TimelineProps> = ({
  segments,
  currentTime,
  totalDuration,
  zoomLevel,
  selectedSegmentId,
  onSeek,
  onSelectSegment,
  onReorderSegments,
  onResizeSegment
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize-left' | 'resize-right' | null;
    segmentId: string | null;
    startX: number;
    originalLeft: number;
    originalWidth: number;
    segmentIndex: number;
  } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Calculate segment positions
  const renderedSegments = useMemo(() => {
    let currentStart = 0;
    return segments.map((seg, index) => {
      const duration = seg.range.end - seg.range.start;
      const width = Math.max(duration * zoomLevel, 20);
      const left = currentStart * zoomLevel;
      currentStart += duration;

      return {
        ...seg,
        left,
        width,
        index,
        duration,
        startTime: currentStart - duration
      };
    });
  }, [segments, zoomLevel]);

  const totalWidth = Math.max(totalDuration * zoomLevel, 100);

  // Handle seek
  const handleSeek = (e: React.MouseEvent) => {
    if (dragState) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, clickX / zoomLevel);
    onSeek(time);
  };

  // Drag start for move
  const handleDragStart = useCallback((e: React.MouseEvent, seg: typeof renderedSegments[0]) => {
    e.stopPropagation();
    e.preventDefault();

    setDragState({
      type: 'move',
      segmentId: seg.id,
      startX: e.clientX,
      originalLeft: seg.left,
      originalWidth: seg.width,
      segmentIndex: seg.index
    });
    onSelectSegment(seg.id);
  }, [onSelectSegment]);

  // Resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, seg: typeof renderedSegments[0], side: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();

    setDragState({
      type: side === 'left' ? 'resize-left' : 'resize-right',
      segmentId: seg.id,
      startX: e.clientX,
      originalLeft: seg.left,
      originalWidth: seg.width,
      segmentIndex: seg.index
    });
    onSelectSegment(seg.id);
  }, [onSelectSegment]);

  // Handle mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState || !containerRef.current) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaTime = deltaX / zoomLevel;

    if (dragState.type === 'move') {
      // Calculate which position to drop at
      const currentX = e.clientX - containerRef.current.getBoundingClientRect().left + containerRef.current.scrollLeft;
      let accumulatedWidth = 0;
      let targetIndex = renderedSegments.length;

      for (let i = 0; i < renderedSegments.length; i++) {
        const midpoint = accumulatedWidth + renderedSegments[i].width / 2;
        if (currentX < midpoint) {
          targetIndex = i;
          break;
        }
        accumulatedWidth += renderedSegments[i].width;
      }

      // Adjust for dragging from original position
      if (targetIndex > dragState.segmentIndex) {
        targetIndex = Math.max(0, targetIndex);
      }

      setDropTargetIndex(targetIndex !== dragState.segmentIndex ? targetIndex : null);
    }
  }, [dragState, zoomLevel, renderedSegments]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (!dragState) return;

    if (dragState.type === 'move' && dropTargetIndex !== null) {
      onReorderSegments(dragState.segmentIndex, dropTargetIndex);
    } else if (dragState.type === 'resize-left' || dragState.type === 'resize-right') {
      // Resize handled in real-time
    }

    setDragState(null);
    setDropTargetIndex(null);
  }, [dragState, dropTargetIndex, onReorderSegments]);

  // Handle resize drag
  const handleResizeDrag = useCallback((e: MouseEvent) => {
    if (!dragState || (dragState.type !== 'resize-left' && dragState.type !== 'resize-right')) return;

    const seg = segments.find(s => s.id === dragState.segmentId);
    if (!seg) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaTime = deltaX / zoomLevel;

    if (dragState.type === 'resize-left') {
      const newStart = Math.max(0, seg.range.start + deltaTime);
      if (newStart < seg.range.end - 0.1) {
        onResizeSegment(seg.id, newStart, seg.range.end);
      }
    } else {
      const newEnd = Math.max(seg.range.start + 0.1, seg.range.end + deltaTime);
      onResizeSegment(seg.id, seg.range.start, newEnd);
    }
  }, [dragState, segments, zoomLevel, onResizeSegment]);

  // Global mouse events for drag
  React.useEffect(() => {
    if (dragState) {
      const handleGlobalMove = (e: MouseEvent) => {
        if (dragState.type === 'resize-left' || dragState.type === 'resize-right') {
          handleResizeDrag(e);
        }
      };
      const handleGlobalUp = () => handleMouseUp();

      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);

      return () => {
        window.removeEventListener('mousemove', handleGlobalMove);
        window.removeEventListener('mouseup', handleGlobalUp);
      };
    }
  }, [dragState, handleMouseUp, handleResizeDrag]);

  return (
    <div className="h-64 border-t border-zinc-800 bg-zinc-900 flex flex-col select-none">
      {/* Time Ruler */}
      <div className="h-6 border-b border-zinc-800 bg-zinc-900/50 relative overflow-hidden flex text-[10px] text-zinc-500 font-mono items-end pb-1 px-2">
         Scale: 1s = {zoomLevel}px
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-x-auto overflow-y-hidden custom-scrollbar"
        onClick={(e) => {
            if (e.target === e.currentTarget) onSelectSegment(null);
        }}
        onMouseMove={dragState?.type === 'move' ? handleMouseMove : undefined}
        onMouseUp={dragState?.type === 'move' ? handleMouseUp : undefined}
        onMouseLeave={dragState?.type === 'move' ? handleMouseUp : undefined}
      >
        <div
          className="relative h-full bg-zinc-950 min-w-full"
          style={{ width: `${totalWidth}px` }}
        >
            {/* Click Layer for Seek */}
            <div
                className="absolute inset-0 z-10"
                onMouseDown={handleSeek}
            />

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-white z-30 pointer-events-none"
              style={{ left: `${currentTime * zoomLevel}px` }}
            >
              <div className="absolute -top-1 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-white"></div>
            </div>

            {/* Drop Indicator */}
            {dropTargetIndex !== null && (
              <div
                className="absolute top-8 bottom-8 w-1 bg-blue-500 z-40 rounded"
                style={{
                  left: dropTargetIndex === 0 ? 0 :
                    renderedSegments.slice(0, dropTargetIndex).reduce((sum, s) => sum + s.width, 0) - 2
                }}
              />
            )}

            {/* Segments Track */}
            <div className="absolute top-8 left-0 right-0 h-24">
              {renderedSegments.map((seg) => (
                <div
                  key={seg.id}
                  className={`
                    absolute top-0 bottom-0 overflow-hidden group rounded-sm z-20 transition-shadow
                    ${selectedSegmentId === seg.id ? 'ring-2 ring-white z-30' : 'hover:brightness-110'}
                    ${dragState?.segmentId === seg.id && dragState.type === 'move' ? 'opacity-50' : ''}
                  `}
                  style={{
                    left: `${seg.left}px`,
                    width: `${seg.width}px`,
                    backgroundColor: seg.color || '#3f3f46',
                    opacity: seg.isBest ? 1 : 0.65,
                    cursor: dragState ? 'grabbing' : 'grab'
                  }}
                  onMouseDown={(e) => handleDragStart(e, seg)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!dragState) onSelectSegment(seg.id);
                  }}
                  title={`${seg.name} (Score: ${seg.score})`}
                >
                    {/* Left Resize Handle */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-40 group-hover:bg-white/10"
                      onMouseDown={(e) => handleResizeStart(e, seg, 'left')}
                    />

                    {/* Right Resize Handle */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-40 group-hover:bg-white/10"
                      onMouseDown={(e) => handleResizeStart(e, seg, 'right')}
                    />

                    {/* Content */}
                    <div className="p-2 h-full flex flex-col justify-between relative pointer-events-none">
                        <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNCIgaGVpZ2h0PSI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDNoNHYxSDB6IiBmaWxsPSIjMDAwIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=')]"></div>

                        <div className="flex justify-between items-start z-10 gap-1">
                             <span className="text-[10px] text-white/90 truncate font-medium drop-shadow-md">
                                {seg.name}
                            </span>
                            <span className={`
                                text-[9px] px-1 rounded font-mono
                                ${seg.score >= 90 ? 'bg-green-500/80 text-white' : 'bg-black/40 text-zinc-300'}
                            `}>
                                {seg.score}
                            </span>
                        </div>

                        {seg.isBest && (
                            <div className="self-end text-yellow-300 text-[10px] drop-shadow-md z-10 font-bold bg-black/40 px-1 rounded-sm border border-yellow-500/30">
                                ★ BEST
                            </div>
                        )}
                    </div>
                </div>
              ))}

              {renderedSegments.length === 0 && (
                <div className="absolute left-4 top-4 text-zinc-600 text-sm italic pointer-events-none">
                   Drag clips here or use "Smart Cut"
                </div>
              )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
