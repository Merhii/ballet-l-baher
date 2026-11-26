import {
  AbsoluteFill, Audio, Img, OffthreadVideo, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { loadFont as loadBarlowCondensed } from '@remotion/google-fonts/BarlowCondensed';
import { loadFont as loadBarlow } from '@remotion/google-fonts/Barlow';
import { loadFont as loadReemKufi } from '@remotion/google-fonts/ReemKufi';
import type { Cut, Line, Scene } from './script';

const COND = loadBarlowCondensed('normal', { weights: ['600', '700'], subsets: ['latin'] }).fontFamily;
const BODY = loadBarlow('normal', { weights: ['500', '600', '700'], subsets: ['latin'] }).fontFamily;
const KUFI = loadReemKufi('normal', { weights: ['600', '700'], subsets: ['arabic'] }).fontFamily;

// the game's own palette (brand/logo-trowel.svg, the HUD)
const NAVY = '#0B3A4F';
const SAND = '#EFE6CC';
const YELLOW = '#F2B733';
const FPS = 30;

export const promoLength = (cut: Cut) =>
  Math.round(cut.scenes.reduce((n, s) => n + s.dur * FPS, 0) - cut.fade * (cut.scenes.length - 1));

export const Promo: React.FC<{ cut: Cut }> = ({ cut }) => (
  <AbsoluteFill style={{ backgroundColor: NAVY }}>
    <TransitionSeries>
      {cut.scenes.flatMap((s, i) => {
        const items = [
          <TransitionSeries.Sequence key={'s' + i} durationInFrames={Math.round(s.dur * FPS)}>
            <SceneView scene={s} cut={cut} />
          </TransitionSeries.Sequence>,
        ];
        if (i < cut.scenes.length - 1) {
          items.push(
            <TransitionSeries.Transition key={'t' + i} presentation={fade()}
              timing={linearTiming({ durationInFrames: cut.fade })} />,
          );
        }
        return items;
      })}
    </TransitionSeries>
  </AbsoluteFill>
);

const SceneView: React.FC<{ scene: Scene; cut: Cut }> = ({ scene, cut }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1, scene.zoom ?? 1.02]);
  const story = cut.format === 'story';
  return (
    <AbsoluteFill>
      {/* the game's own sound for this clip, recorded with it */}
      <Audio src={staticFile(`clips/${cut.format}/${scene.clip}.wav`)}
        trimBefore={Math.round((scene.from ?? 0) * FPS)} />
      {scene.inset ? (
        <>
          {/* a blurred copy fills the frame; the clip sits on it as a card */}
          <AbsoluteFill style={{ transform: 'scale(1.15)', filter: 'blur(26px) brightness(.75)' }}>
            <Clip scene={scene} cut={cut} />
          </AbsoluteFill>
          <AbsoluteFill style={{
            transform: `translateY(${scene.inset.y}px) scale(${scene.inset.scale * zoom})`,
            borderRadius: 34, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)',
            border: `5px solid ${SAND}`,
          }}>
            <Clip scene={scene} cut={cut} />
          </AbsoluteFill>
        </>
      ) : (
        <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
          <Clip scene={scene} cut={cut} />
        </AbsoluteFill>
      )}
      {/* a soft shade behind the captions so they read on any frame */}
      {scene.lines.length > 0 && (
        <AbsoluteFill style={{
          background: `linear-gradient(180deg, rgba(11,58,79,.55) 0%, rgba(11,58,79,0) ${story ? 42 : 50}%)`,
        }} />
      )}
      <div style={{
        position: 'absolute', left: 64, right: 64,
        // Instagram covers the top ~250 px of a story with its own bar
        top: story ? 300 : 70,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 22,
      }}>
        {scene.lines.map((l, i) => <Caption key={i} line={l} story={story} />)}
      </div>
      {scene.end && <EndCard story={story} soon={!!scene.soon} />}
    </AbsoluteFill>
  );
};

const Clip: React.FC<{ scene: Scene; cut: Cut }> = ({ scene, cut }) => (
  <OffthreadVideo
    src={staticFile(`clips/${cut.format}/${scene.clip}.mp4`)}
    trimBefore={Math.round((scene.from ?? 0) * FPS)}
    muted
    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
  />
);

const Caption: React.FC<{ line: Line; story: boolean }> = ({ line, story }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = Math.round((line.at ?? 0.2) * fps);
  const p = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 170 } });
  const base: React.CSSProperties = {
    opacity: p,
    transform: `translateY(${(1 - p) * 34}px)`,
  };
  if (line.arabic) {
    return (
      <div dir="rtl" style={{
        ...base, fontFamily: KUFI, fontWeight: 700, color: NAVY,
        fontSize: story ? 150 : 128, lineHeight: 1.15,
        background: SAND, padding: '6px 34px 18px', border: `6px solid ${NAVY}`,
        boxShadow: `10px 10px 0 ${NAVY}`, textShadow: `5px 5px 0 ${YELLOW}`,
      }}>
        {line.text}
      </div>
    );
  }
  if (line.kicker) {
    return (
      <div style={{
        ...base, fontFamily: BODY, fontWeight: 600, color: SAND,
        fontSize: story ? 44 : 40, lineHeight: 1.2, maxWidth: '92%',
        textShadow: '0 2px 12px rgba(0,0,0,.45)',
      }}>
        {line.text}
      </div>
    );
  }
  return (
    <div style={{
      ...base, fontFamily: COND, fontWeight: 700, color: NAVY, textTransform: 'uppercase',
      fontSize: line.big ? (story ? 92 : 74) : (story ? 54 : 46),
      lineHeight: 1.02, letterSpacing: '0.01em', maxWidth: '100%',
      background: SAND, padding: line.big ? '14px 26px 12px' : '10px 22px 8px',
      border: `5px solid ${NAVY}`, boxShadow: `9px 9px 0 ${NAVY}`,
    }}>
      {line.text}
    </div>
  );
};

const Stripes: React.FC<{ top?: boolean }> = ({ top }) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, height: 34, [top ? 'top' : 'bottom']: 0,
    background: `repeating-linear-gradient(135deg, ${YELLOW} 0 34px, ${NAVY} 34px 68px)`,
  }} />
);

const EndCard: React.FC<{ story: boolean; soon: boolean }> = ({ story, soon }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shade = interpolate(frame, [0, 18], [0, 0.72], { extrapolateRight: 'clamp' });
  const pop = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 160 } });
  const rise = (delay: number): React.CSSProperties => {
    const p = pop(delay);
    return { opacity: p, transform: `translateY(${(1 - p) * 40}px)` };
  };
  const logo = pop(6);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: `rgba(11,58,79,${shade})` }} />
      <Stripes top />
      <Stripes />
      <AbsoluteFill style={{
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        gap: story ? 26 : 18, paddingBottom: story ? 120 : 0,
      }}>
        <Img src={staticFile('logo-trowel.svg')} style={{
          width: story ? 230 : 170, height: story ? 230 : 170,
          transform: `scale(${logo}) rotate(${(1 - logo) * -25}deg)`,
        }} />
        <div dir="rtl" style={{
          ...rise(12), fontFamily: KUFI, fontWeight: 700, color: SAND,
          fontSize: story ? 190 : 150, lineHeight: 1.1, textShadow: `7px 7px 0 ${YELLOW}`,
        }}>
          بلّط البحر
        </div>
        <div style={{
          ...rise(18), fontFamily: COND, fontWeight: 700, color: SAND,
          fontSize: story ? 104 : 84, letterSpacing: '0.06em', lineHeight: 1,
        }}>
          BALLET L BA7ER
        </div>
        <div style={{
          ...rise(26), fontFamily: BODY, fontWeight: 600, color: SAND, opacity: 0.9 * pop(26),
          fontSize: story ? 42 : 36,
        }}>
          Free 3D browser game · phone or PC
        </div>
        <div style={{
          ...rise(34), marginTop: story ? 30 : 16, fontFamily: COND, fontWeight: 700, color: NAVY,
          background: YELLOW, fontSize: story ? 76 : 62, padding: '12px 40px 10px',
          border: `5px solid ${SAND}`, boxShadow: `9px 9px 0 rgba(0,0,0,.35)`, letterSpacing: '0.02em',
        }}>
          balletlba7er.com
        </div>
        {soon && (
          <div style={{
            ...rise(48), marginTop: story ? 26 : 12, fontFamily: COND, fontWeight: 600, color: YELLOW,
            fontSize: story ? 46 : 38, letterSpacing: '0.14em', textTransform: 'uppercase',
          }}>
            More coming soon
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

