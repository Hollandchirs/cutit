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
interface VideoDisplayProps {
    src?: string;
    poster?: string;
    onUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const VideoDisplay = React.forwardRef<HTMLVideoElement, VideoDisplayProps>(({ src, poster, onUpload }, ref) => {
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
                <label className="cursor-pointer flex flex-col items-center justify-center w-full h-full">
                    <input
                        type="file"
                        multiple
                        accept="video/*"
                        onChange={onUpload}
                        className="hidden"
                    />
                    <div className="flex flex-col items-center space-y-4 p-8 border-2 border-dashed border-zinc-700 rounded-xl hover:border-zinc-500 hover:bg-zinc-900/30 transition-all">
                        <svg className="w-12 h-12 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                        </svg>
                        <div className="text-center">
                            <p className="text-zinc-400 font-medium">Drop files to Import</p>
                            <p className="text-zinc-600 text-sm mt-1">or click to browse</p>
                        </div>
                    </div>
                </label>
            )}
        </div>
    )
});
