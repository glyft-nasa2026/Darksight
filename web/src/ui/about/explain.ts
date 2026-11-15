// "Why the Moon is different" (T39): the About panel's plain-words explainer, as data so a test can
// hold each point to two sentences and check that every place it points to is still on the page.
// Fixed facts only, each with a source in docs/sources/T39.md. Nothing about a particular site or
// date: those numbers come from core/ and are on the page itself.

export type ExplainPoint = {
  /** Bold start of the first sentence, ending with a colon. */
  lead: string;
  /** The rest: two sentences or fewer, counting the lead's. */
  text: string;
  /** The button that closes the panel and goes to where the page shows this. */
  jump: string;
  /** Where the button goes: the first selector that is on screen wins. */
  targets: string[];
  /** The control to focus there, if not simply the first one. */
  focus?: string;
};

export const EXPLAIN_INTRO =
  'The Moon is close, but working there is nothing like working on Earth. Five differences, and ' +
  'where this page shows each one:';

export const EXPLAIN: ExplainPoint[] = [
  {
    lead: 'A day lasts a month:',
    text: 'one sunrise to the next takes about 29.5 Earth days, so away from the poles a site has ' +
      'about two weeks of light, then about two weeks of dark. A lander\'s batteries have to last ' +
      'the night.',
    jump: 'See the Sun strips',
    targets: ['#compare'],
  },
  {
    lead: 'No air:',
    text: 'the Moon has almost no atmosphere, so the sky is black even by day, there is no ' +
      'twilight, and shadows have hard edges. A ridge either blocks the Sun or it doesn\'t, and ' +
      'nothing bends the light round it.',
    jump: 'See the shadows on the map',
    targets: ['#scene'],
  },
  {
    lead: 'The Sun stays low at the poles:',
    text: 'it circles the sky just above or below the horizon all year. So the shape of the ground ' +
      'decides where the light falls: a crater rim can be lit most of the time while the floor ' +
      'beside it never sees the Sun.',
    jump: 'Turn on the "Never lit" map layer',
    targets: ['.scene-layers', '#scene'],
    focus: '#ly-psr',
  },
  {
    lead: 'Earth hardly moves:',
    text: 'the Moon turns once for every orbit, so from the near side Earth stays in about the same ' +
      'part of the sky all month, and from most of the far side it never rises. Radio contact ' +
      'depends more on where you land than on when.',
    jump: 'See Earth\'s path in the sky panorama',
    targets: ['#sky'],
  },
  {
    lead: 'Small moves, big changes:',
    text: 'near the poles, a step of 1 km or a wait of one day can take a site from sunlight into ' +
      'shadow. The Nudge panel on the map says in words what each step gains or loses.',
    jump: 'Try the Nudge panel',
    targets: ['#nudge', '#scene'],
    focus: '.nudge-fold',
  },
];

/** Sentences in a piece of text: a full stop, ? or ! followed by a space or the end. */
export function sentenceCount(s: string): number {
  return (s.trim().match(/[.!?](?=\s|$)/g) ?? []).length;
}
