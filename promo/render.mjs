/* Renders both cuts and evens out the loudness for social media (-16 LUFS).
     node render.mjs */
import { execFileSync } from 'node:child_process';
import { renameSync } from 'node:fs';

for (const [id, name] of [['Story', 'story'], ['Feed', 'linkedin']]) {
  const raw = `out/.raw-${name}.mp4`, out = `out/ballet-l-ba7er-${name}.mp4`;
  execFileSync('npx', ['remotion', 'render', 'src/index.ts', id, raw, '--codec=h264', '--crf=16', '--log=error'],
    { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c:v', 'copy',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', out]);
  renameSync(raw, raw.replace('.raw-', '.prev-'));
  console.log(out);
}
