import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
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
  onResizeStart: () => void;
  onResizeSegment: (id: string, newStart: number, newEnd: number) => void;
  onResizeEnd: () => void;
  onToggleMute?: (id: string) => void;
}

// Minimum pixel movement before resize triggers (lower = more sensitive)
const MIN_RESIZE_DELTA = 2;

const Timeline: React.FC<TimelineProps> = ({
  segments,
  currentTime,
  totalDuration,
  zoomLevel,
  selectedSegmentId,
  onSeek,
  onSelectSegment,
  onReorderSegments,
  onResizeStart,
  onResizeSegment,
  onResizeEnd,
  onToggleMute
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize-left' | 'resize-right' | null;
    segmentId: string | null;
    startX: number;
    originalLeft: number;
    originalWidth: number;
    segmentIndex: number;
    resizeCommitted: boolean; // true once actual resize has begun
    originalStart: number;
    originalEnd: number;
  } | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Calculate segment positions - split segments with cuts into visual slices
  const renderedSegments = useMemo(() => {
    let currentLeft = 0;
    const result: Array<{
      id: string;
      segmentId: string;
      clipId: string;
      left: number;
      width: number;
      index: number;
      duration: number;
      range: { start: number; end: number };
      isBest: boolean;
      color: string;
      name: string;
      isCutPortion: boolean; // true if this slice is a cut (grayed out) portion
      isMuted: boolean; // true if the segment audio is muted
    }> = [];

    segments.forEach((seg, index) => {
      if (!seg.cuts || seg.cuts.length === 0) {
        // No cuts - render as single segment
        const duration = seg.range.end - seg.range.start;
        const width = Math.max(duration * zoomLevel, 20);
        result.push({
          id: `${seg.id}-full`,
          segmentId: seg.id,
          clipId: seg.clipId,
          left: currentLeft,
          width,
          index,
          duration,
          range: seg.range,
          isBest: seg.isBest,
          color: seg.color,
          name: seg.name,
          isCutPortion: false,
          isMuted: !!seg.isMuted
        });
        currentLeft += width;
      } else {
        // Has cuts - split into slices (normal parts + cut parts)
        const sortedCuts = [...seg.cuts].sort((a, b) => a.start - b.start);
        let currentTime = seg.range.start;
        let sliceIndex = 0;

        for (const cut of sortedCuts) {
          // Add normal portion before cut
          if (cut.start > currentTime) {
            const sliceDuration = cut.start - currentTime;
            const width = Math.max(sliceDuration * zoomLevel, 5);
            result.push({
              id: `${seg.id}-${sliceIndex}`,
              segmentId: seg.id,
              clipId: seg.clipId,
              left: currentLeft,
              width,
              index,
              duration: sliceDuration,
              range: { start: currentTime, end: cut.start },
              isBest: seg.isBest,
              color: seg.color,
              name: seg.name,
              isCutPortion: false,
              isMuted: !!seg.isMuted
            });
            currentLeft += width;
            sliceIndex++;
          }

          // Add the cut portion (grayed out)
          const cutDuration = cut.end - cut.start;
          const cutWidth = Math.max(cutDuration * zoomLevel, 5);
          result.push({
            id: `${seg.id}-cut-${sliceIndex}`,
            segmentId: seg.id,
            clipId: seg.clipId,
            left: currentLeft,
            width: cutWidth,
            index,
            duration: cutDuration,
            range: { start: cut.start, end: cut.end },
            isBest: seg.isBest,
            color: seg.color,
            name: seg.name,
            isCutPortion: true, // This is a cut portion
            isMuted: !!seg.isMuted
          });
          currentLeft += cutWidth;
          sliceIndex++;
          currentTime = cut.end;
        }

        // Add normal portion after last cut
        if (currentTime < seg.range.end) {
          const sliceDuration = seg.range.end - currentTime;
          const width = Math.max(sliceDuration * zoomLevel, 5);
          result.push({
            id: `${seg.id}-${sliceIndex}`,
            segmentId: seg.id,
            clipId: seg.clipId,
            left: currentLeft,
            width,
            index,
            duration: sliceDuration,
            range: { start: currentTime, end: seg.range.end },
            isBest: seg.isBest,
            color: seg.color,
            name: seg.name,
            isCutPortion: false,
            isMuted: !!seg.isMuted
          });
          currentLeft += width;
        }
      }
    });

    return result;
  }, [segments, zoomLevel]);

  const totalWidth = Math.max(totalDuration * zoomLevel, 100);

  // Debug: log when segments with cuts change
  useEffect(() => {
    const segsWithCuts = segments.filter(s => s.cuts && s.cuts.length > 0);
    if (segsWithCuts.length > 0) {
      console.log(`[Timeline] ${segsWithCuts.length} segments have cuts:`, segsWithCuts.map(s => ({
        id: s.id,
        cuts: s.cuts
      })));
    }
  }, [segments]);

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

  // Mouse down - prepare for potential drag (but don't start drag yet)
  const handleMouseDown = useCallback((e: React.MouseEvent, seg: typeof renderedSegments[0]) => {
    e.stopPropagation();
    
    // Only start drag if it's a left mouse button
    if (e.button !== 0) return;
    
    // Store initial position for drag detection
    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;
    let dragStarted = false;

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - startX);
      const deltaY = Math.abs(moveEvent.clientY - startY);
      
      // Only start drag if mouse moved more than 5px (to distinguish from click)
      if (!dragStarted && (deltaX > 5 || deltaY > 5)) {
        hasMoved = true;
        dragStarted = true;
        
        setDragState({
          type: 'move',
          segmentId: seg.segmentId, // Use original segment ID
          startX: moveEvent.clientX,
          originalLeft: seg.left,
          originalWidth: seg.width,
          segmentIndex: seg.index,
          resizeCommitted: false,
          originalStart: seg.range.start,
          originalEnd: seg.range.end
        });
        onSelectSegment(seg.segmentId); // Use original segment ID
      }
    };

    const handleUp = () => {
      // If mouse was released without moving, treat it as a click (select only)
      if (!hasMoved) {
        onSelectSegment(seg.segmentId); // Use original segment ID
      }
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [onSelectSegment]);

  // Resize start (local handler)
  const handleResizeStartLocal = useCallback((e: React.MouseEvent, seg: typeof renderedSegments[0], side: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();

    setDragState({
      type: side === 'left' ? 'resize-left' : 'resize-right',
      segmentId: seg.segmentId, // Use original segment ID
      startX: e.clientX,
      originalLeft: seg.left,
      originalWidth: seg.width,
      segmentIndex: seg.index,
      resizeCommitted: false,
      originalStart: seg.range.start,
      originalEnd: seg.range.end
    });
    onSelectSegment(seg.segmentId); // Use original segment ID
  }, [onSelectSegment]);

  // Handle mouse move during drag
  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState || dragState.type !== 'move' || !containerRef.current) return;

    // Calculate mouse position relative to timeline container
    const containerRect = containerRef.current.getBoundingClientRect();
    const currentX = e.clientX - containerRect.left + containerRef.current.scrollLeft;
    
    const draggedOriginalIndex = dragState.segmentIndex; // Original segment index
    let targetOriginalIndex = draggedOriginalIndex; // Default to current position
    let accumulatedWidth = 0;
    let foundTarget = false;

    // Find insertion point by checking each rendered segment
    // Note: renderedSegments can have multiple visual segments per original segment (due to cuts)
    for (let i = 0; i < renderedSegments.length; i++) {
      const seg = renderedSegments[i];
      const segOriginalIndex = seg.index; // Original segment index
      
      // Skip visual segments that belong to the dragged original segment
      if (segOriginalIndex === draggedOriginalIndex) {
        accumulatedWidth += seg.width;
        continue;
      }
      
      const segmentStart = accumulatedWidth;
      const segmentEnd = accumulatedWidth + seg.width;
      
      // Check if mouse is in this segment's range
      if (currentX >= segmentStart && currentX <= segmentEnd) {
        // Determine if we should insert before or after this original segment
        const midpoint = segmentStart + seg.width / 2;
        targetOriginalIndex = currentX < midpoint ? segOriginalIndex : segOriginalIndex + 1;
        foundTarget = true;
        break;
      }
      
      // If mouse is before this segment, insert at this original index
      if (currentX < segmentStart) {
        targetOriginalIndex = segOriginalIndex;
        foundTarget = true;
        break;
      }
      
      accumulatedWidth += seg.width;
    }
    
    // If we've passed all segments, insert at the end
    if (!foundTarget && currentX > accumulatedWidth) {
      targetOriginalIndex = segments.length;
    }

    // Only set drop target if it's different from current position
    if (targetOriginalIndex !== draggedOriginalIndex && targetOriginalIndex >= 0 && targetOriginalIndex <= segments.length) {
      setDropTargetIndex(targetOriginalIndex);
    } else {
      setDropTargetIndex(null);
    }
  }, [dragState, renderedSegments, segments.length]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    if (!dragState) return;

    if (dragState.type === 'move' && dropTargetIndex !== null) {
      onReorderSegments(dragState.segmentIndex, dropTargetIndex);
    } else if (dragState.type === 'resize-left' || dragState.type === 'resize-right') {
      // Commit resize to history if actual resize happened
      if (dragState.resizeCommitted) {
        onResizeEnd();
      }
    }

    setDragState(null);
    setDropTargetIndex(null);
  }, [dragState, dropTargetIndex, onReorderSegments, onResizeEnd]);

  // Handle resize drag
  const handleResizeDrag = useCallback((e: MouseEvent) => {
    if (!dragState || (dragState.type !== 'resize-left' && dragState.type !== 'resize-right')) return;

    const deltaX = e.clientX - dragState.startX;

    // Check minimum movement threshold for smoother feel
    if (Math.abs(deltaX) < MIN_RESIZE_DELTA && !dragState.resizeCommitted) {
      return;
    }

    // Call onResizeStart only once when actual resize begins
    if (!dragState.resizeCommitted) {
      onResizeStart();
      setDragState(prev => prev ? { ...prev, resizeCommitted: true } : null);
    }

    const deltaTime = deltaX / zoomLevel;

    if (dragState.type === 'resize-left') {
      const newStart = Math.max(0, dragState.originalStart + deltaTime);
      if (newStart < dragState.originalEnd - 0.1) {
        onResizeSegment(dragState.segmentId!, newStart, dragState.originalEnd);
      }
    } else {
      const newEnd = Math.max(dragState.originalStart + 0.1, dragState.originalEnd + deltaTime);
      onResizeSegment(dragState.segmentId!, dragState.originalStart, newEnd);
    }
  }, [dragState, zoomLevel, onResizeSegment, onResizeStart]);

  // Global mouse events for drag
  React.useEffect(() => {
    if (dragState) {
      const handleGlobalMove = (e: MouseEvent) => {
        if (dragState.type === 'resize-left' || dragState.type === 'resize-right') {
          handleResizeDrag(e);
        } else if (dragState.type === 'move') {
          handleGlobalMouseMove(e);
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
  }, [dragState, handleMouseUp, handleResizeDrag, handleGlobalMouseMove]);

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
            {dropTargetIndex !== null && (() => {
              // Calculate visual position for drop indicator based on original segment index
              // Find the first rendered segment with index >= dropTargetIndex
              let dropLeft = 0;
              for (const seg of renderedSegments) {
                if (seg.index >= dropTargetIndex) {
                  break;
                }
                dropLeft += seg.width;
              }
              return (
                <div
                  className="absolute top-8 bottom-8 w-1 bg-blue-500 z-40 rounded"
                  style={{ left: Math.max(0, dropLeft - 2) }}
                />
              );
            })()}

            {/* Segments Track */}
            <div className="absolute top-8 left-0 right-0 h-24">
              {renderedSegments.map((seg) => (
                <div
                  key={seg.id}
                  className={`
                    absolute top-0 bottom-0 overflow-hidden group rounded-sm z-20 transition-shadow
                    ${selectedSegmentId === seg.segmentId ? 'ring-2 ring-white z-30' : 'hover:brightness-110'}
                    ${dragState?.segmentId === seg.segmentId && dragState.type === 'move' ? 'opacity-50' : ''}
                  `}
                  style={{
                    left: `${seg.left}px`,
                    width: `${seg.width}px`,
                    backgroundColor: seg.color || '#3f3f46',
                    opacity: seg.isBest ? 1 : 0.65,
                    filter: seg.isCutPortion ? 'brightness(0.4)' : seg.isMuted ? 'saturate(0.3) brightness(0.7)' : 'none',
                    cursor: dragState ? 'grabbing' : 'grab'
                  }}
                  onMouseDown={(e) => handleMouseDown(e, seg)}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Click is handled in handleMouseDown if no drag occurred
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (onToggleMute) onToggleMute(seg.segmentId);
                  }}
                  title={seg.isMuted ? `[已剪切] ${seg.name}` : seg.isCutPortion ? `[已剪切] ${seg.name}` : seg.name}
                >
                    {/* Left Resize Handle - only for non-cut portions */}
                    {!seg.isCutPortion && (
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-40 group-hover:bg-white/10"
                        onMouseDown={(e) => handleResizeStartLocal(e, seg, 'left')}
                      />
                    )}

                    {/* Right Resize Handle - only for non-cut portions */}
                    {!seg.isCutPortion && (
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-40 group-hover:bg-white/10"
                        onMouseDown={(e) => handleResizeStartLocal(e, seg, 'right')}
                      />
                    )}

                    {/* Content */}
                    <div className="p-2 h-full flex flex-col justify-start relative pointer-events-none">
                        {seg.isCutPortion ? (
                          <>
                            {/* Strikethrough line for cut portions */}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-full h-0.5 bg-zinc-500"></div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNCIgaGVpZ2h0PSI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDNoNHYxSDB6IiBmaWxsPSIjMDAwIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L3N2Zz4=')]"></div>
                            <div className="flex items-center gap-1 z-10">
                              {seg.isMuted && (
                                <svg className="w-3 h-3 text-zinc-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"/>
                                </svg>
                              )}
                              <span className="text-[10px] text-white/90 truncate font-medium drop-shadow-md">
                                  {seg.name}
                              </span>
                            </div>
                          </>
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
