import React, { useRef, useEffect } from 'react';
import { TimelineSegment } from '../types';

interface PlayerProps {
  currentSegment: TimelineSegment | null;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onEnded: () => void;
  seekTime: number | null; // Signal to seek
}

const Player: React.FC<PlayerProps> = ({ 
  currentSegment, 
  isPlaying, 
  onTimeUpdate,
  onEnded,
  seekTime
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  // Sync select clip
  useEffect(() => {
    if (videoRef.current && currentSegment) {
       // We only change src if the clip ID changes to avoid reloading
       const currentSrc = videoRef.current.getAttribute('data-clip-id');
       if (currentSrc !== currentSegment.clipId) {
           // Find the clip URL from the parent state is hard here without passing full clip object.
           // But actually, we can manage the Source in parent or passed down.
           // For simplicity, let's assume the segment object has what we need or we pass the URL.
           // Wait, TimelineSegment doesn't have URL. Let's fix this in Parent to pass the URL.
           // We will rely on the parent logic to manage the "active clip URL" outside this component maybe?
           // No, standard player logic needs the URL.
           // Updated: Parent will control the `src` prop.
       }
    }
  }, [currentSegment]);

  return (
    <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden">
        {!currentSegment ? (
            <div className="text-zinc-600 flex flex-col items-center">
                <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                <p>No Clip Selected</p>
            </div>
        ) : (
            <div className="w-full h-full relative">
               {/* Note: The actual <video> tag is controlled by the Parent App component usually for complex timeline logic 
                   But here we render it. The Parent needs to pass the specific URL for the current segment.
               */}
            </div>
        )}
    </div>
  );
};
// Revamping Player to be simpler: Just a wrapper for the video element controlled by App
export const VideoDisplay = React.forwardRef<HTMLVideoElement, { src?: string; poster?: string }>(({ src, poster }, ref) => {
    return (
        <div className="w-full h-full bg-black flex items-center justify-center">
            {src ? (
                <video 
                    ref={ref}
                    className="max-h-full max-w-full shadow-2xl"
                    src={src}
                    poster={poster}
                />
            ) : (
                 <div className="text-zinc-600 flex flex-col items-center">
                    <p>Preview Area</p>
                </div>
            )}
        </div>
    )
});
