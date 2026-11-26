/* The two cuts: which clip plays when, and what the captions say.
   Clips come from capture/record.mjs (public/clips/<format>/<shot>.mp4).
   Times are in seconds. */

export type Line = {
  text: string;
  at?: number;          // seconds into the scene the line appears (default 0.2)
  big?: boolean;        // headline size
  arabic?: boolean;     // set in Reem Kufi, right to left
  kicker?: boolean;     // small, above the rest
};

export type Scene = {
  clip: string;         // shot name
  from?: number;        // seconds into the clip to start
  dur: number;          // seconds on screen
  lines: Line[];
  end?: boolean;        // the end card goes over this scene
  zoom?: number;        // slow push-in, 1.0 = none
  inset?: { scale: number; y: number };   // shrink the clip into a card over a blurred copy
  soon?: boolean;       // the end card says more is coming
};

export type Cut = {
  format: 'story' | 'feed';
  scenes: Scene[];
  fade: number;         // frames of crossfade between scenes
};

export const STORY: Cut = {
  format: 'story',
  fade: 8,
  scenes: [
    {
      clip: 'establish', dur: 3.6, zoom: 1.06,
      lines: [
        { text: 'In Lebanon, to tell someone to get lost:', kicker: true },
        { text: 'روح بلّط البحر', arabic: true, at: 0.5 },
        { text: '“Go tile the sea.”', big: true, at: 1.2 },
      ],
    },
    {
      clip: 'lay', from: 0.3, dur: 3.4, zoom: 1.04,
      lines: [
        { text: 'So I made it a game.', kicker: true },
        { text: 'Tile the sea.', big: true, at: 0.5 },
      ],
    },
    {
      clip: 'food', from: 0.3, dur: 3.3,
      lines: [
        { text: 'Eat at Souk el Akel.', big: true },
        { text: 'Soubras. Falafel. Bouza.', at: 0.6 },
      ],
    },
    {
      clip: 'ziri', from: 1.05, dur: 3.4,
      lines: [
        { text: 'Take Abou Ali’s boat', kicker: true },
        { text: 'to the Ziri.', big: true, at: 0.3 },
      ],
    },
    {
      clip: 'hit', from: 0, dur: 3.8,
      lines: [
        { text: 'Hit Abou Nabil.', big: true },
        { text: 'He hits back.', big: true, at: 1.05 },
      ],
    },
    { clip: 'outro', dur: 4.4, end: true, soon: true, zoom: 1.05, lines: [] },
  ],
};

export const FEED: Cut = {
  format: 'feed',
  fade: 10,
  scenes: [
    {
      clip: 'establish', dur: 5, zoom: 1.06,
      lines: [
        { text: 'A Lebanese saying, for “go do something pointless”:', kicker: true },
        { text: 'روح بلّط البحر', arabic: true, at: 0.6 },
        { text: '“Go tile the sea.”', big: true, at: 1.4 },
      ],
    },
    {
      clip: 'lay', from: 0.2, dur: 4.6, zoom: 1.04,
      lines: [
        { text: 'I took it literally.', kicker: true },
        { text: 'A 3D browser game: tile the sea off the Saida corniche.', big: true, at: 0.6 },
      ],
    },
    {
      clip: 'mason', from: 0.5, dur: 3.4, zoom: 1.04,
      lines: [{ text: 'The waves take your edges back.', big: true }],
    },
    {
      clip: 'food', from: 0.3, dur: 4.6,
      lines: [
        { text: 'Hungry? Souk el Akel.', big: true },
        { text: 'Soubras, falafel, bouza from el Samra.', at: 0.6 },
      ],
    },
    {
      clip: 'ziri', from: 0.9, dur: 4.6,
      lines: [
        { text: 'Take Abou Ali’s boat out to the Ziri.', big: true },
      ],
    },
    {
      clip: 'hit', from: 0, dur: 4.4,
      lines: [
        { text: 'Meet the corniche regulars.', kicker: true },
        { text: 'Don’t hit Abou Nabil.', big: true, at: 0.4 },
        { text: 'He hits back.', at: 1.1 },
      ],
    },
    { clip: 'outro', dur: 5.4, end: true, soon: true, zoom: 1.05, lines: [] },
  ],
};
