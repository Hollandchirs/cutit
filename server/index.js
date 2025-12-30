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

app.listen(PORT, () => {
  console.log(`🎬 Compression server running on http://localhost:${PORT}`);
});
