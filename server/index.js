import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import cors from 'cors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

// CORS for frontend
app.use(cors());

// Temp storage for uploads
const upload = multer({
  dest: join(__dirname, 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

// Compress video to 720p
app.post('/api/compress', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const inputPath = req.file.path;
  const outputPath = join(__dirname, 'temp', `${randomUUID()}.mp4`);

  const inputSize = (req.file.size / (1024 * 1024)).toFixed(1);
  console.log(`[Compress] Input: ${req.file.originalname} (${inputSize}MB)`);

  try {
    // FFmpeg compression to 720p
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-vf', 'scale=-2:720',      // Scale to 720p, maintain aspect ratio
        '-c:v', 'libx264',          // H.264 codec
        '-crf', '28',               // Quality (18-28 is good, higher = smaller)
        '-preset', 'fast',          // Speed/quality tradeoff
        '-c:a', 'aac',              // Audio codec
        '-b:a', '128k',             // Audio bitrate
        '-movflags', '+faststart',  // Web optimization
        '-y',                       // Overwrite output
        outputPath
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log progress (FFmpeg outputs to stderr)
        const timeMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (timeMatch) {
          process.stdout.write(`\r[Compress] Progress: ${timeMatch[1]}`);
        }
      });

      ffmpeg.on('close', (code) => {
        console.log(''); // New line after progress
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      ffmpeg.on('error', reject);
    });

    // Get output file size
    const outputStats = statSync(outputPath);
    const outputSize = (outputStats.size / (1024 * 1024)).toFixed(1);
    console.log(`[Compress] Output: ${outputSize}MB (${Math.round((1 - outputStats.size / req.file.size) * 100)}% reduction)`);

    // Stream back the compressed file
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', outputStats.size);
    res.setHeader('X-Original-Size', req.file.size);
    res.setHeader('X-Compressed-Size', outputStats.size);

    const readStream = createReadStream(outputPath);
    readStream.pipe(res);

    readStream.on('end', () => {
      // Cleanup temp files
      try {
        unlinkSync(inputPath);
        unlinkSync(outputPath);
      } catch (e) {
        console.warn('[Cleanup] Failed:', e.message);
      }
    });

  } catch (error) {
    console.error('[Compress] Error:', error.message);

    // Cleanup on error
    try { unlinkSync(inputPath); } catch (e) {}
    try { unlinkSync(outputPath); } catch (e) {}

    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ffmpeg: true });
});

// Export video - merge segments from multiple videos
app.post('/api/export', upload.array('videos', 10), async (req, res) => {
  const files = req.files;
  const segments = JSON.parse(req.body.segments || '[]');

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No video files provided' });
  }

  if (!segments || segments.length === 0) {
    return res.status(400).json({ error: 'No segments provided' });
  }

  console.log(`[Export] Starting: ${files.length} videos, ${segments.length} segments`);

  // Map file names to paths
  const fileMap = {};
  files.forEach(f => {
    fileMap[f.originalname] = f.path;
  });

  const tempDir = join(__dirname, 'temp');
  const segmentFiles = [];
  const outputPath = join(tempDir, `export_${randomUUID()}.mp4`);
  const concatListPath = join(tempDir, `concat_${randomUUID()}.txt`);

  try {
    // Step 1: Extract each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const inputPath = fileMap[seg.fileName];

      if (!inputPath) {
        console.warn(`[Export] File not found: ${seg.fileName}`);
        continue;
      }

      const segmentPath = join(tempDir, `seg_${i}_${randomUUID()}.mp4`);
      const duration = seg.end - seg.start;

      console.log(`[Export] Segment ${i + 1}/${segments.length}: ${seg.fileName} [${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s]`);

      await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-ss', seg.start.toString(),
          '-i', inputPath,
          '-t', duration.toString(),
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-avoid_negative_ts', 'make_zero',
          '-y',
          segmentPath
        ]);

        ffmpeg.stderr.on('data', (data) => {
          const timeMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
          if (timeMatch) {
            process.stdout.write(`\r[Export] Extracting: ${timeMatch[1]}`);
          }
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            segmentFiles.push(segmentPath);
            resolve();
          } else {
            reject(new Error(`FFmpeg segment extraction failed with code ${code}`));
          }
        });

        ffmpeg.on('error', reject);
      });

      console.log('');
    }

    if (segmentFiles.length === 0) {
      throw new Error('No segments were extracted');
    }

    // Step 2: Create concat list file
    const concatContent = segmentFiles.map(f => `file '${f}'`).join('\n');
    const { writeFileSync } = await import('fs');
    writeFileSync(concatListPath, concatContent);

    console.log(`[Export] Merging ${segmentFiles.length} segments...`);

    // Step 3: Concat all segments
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ]);

      ffmpeg.stderr.on('data', (data) => {
        const timeMatch = data.toString().match(/time=(\d{2}:\d{2}:\d{2})/);
        if (timeMatch) {
          process.stdout.write(`\r[Export] Merging: ${timeMatch[1]}`);
        }
      });

      ffmpeg.on('close', (code) => {
        console.log('');
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg concat failed with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
    });

    // Get output file info
    const outputStats = statSync(outputPath);
    const outputSize = (outputStats.size / (1024 * 1024)).toFixed(1);
    console.log(`[Export] Done: ${outputSize}MB`);

    // Stream back the merged file
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', outputStats.size);
    res.setHeader('Content-Disposition', 'attachment; filename="exported_video.mp4"');

    const readStream = createReadStream(outputPath);
    readStream.pipe(res);

    readStream.on('end', () => {
      // Cleanup
      try {
        files.forEach(f => unlinkSync(f.path));
        segmentFiles.forEach(f => unlinkSync(f));
        unlinkSync(concatListPath);
        unlinkSync(outputPath);
      } catch (e) {
        console.warn('[Export Cleanup] Failed:', e.message);
      }
    });

  } catch (error) {
    console.error('[Export] Error:', error.message);

    // Cleanup on error
    try {
      files.forEach(f => { try { unlinkSync(f.path); } catch (e) {} });
      segmentFiles.forEach(f => { try { unlinkSync(f); } catch (e) {} });
      try { unlinkSync(concatListPath); } catch (e) {}
      try { unlinkSync(outputPath); } catch (e) {}
    } catch (e) {}

    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎬 Compression server running on http://localhost:${PORT}`);
});
