// The text of the main page's lower sections (issue #117): about, team, privacy, licence and the
// footer links. Pure data, no DOM, so it can be tested in node; more.ts draws it. Keep the words
// here, in one place, so they are easy to update at the freeze.

export const REPO_URL = 'https://github.com/glyft-nasa2026/Darksight';
export const SITE_URL = 'https://darksight.space';
export const CHALLENGE_URL =
  'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/';

export interface Link {
  label: string;
  href: string;
}

export interface Section {
  /** Element id, so the footer can scroll to it. Never a page-address hash: state.ts owns that. */
  id: string;
  heading: string;
  paragraphs: string[];
  links?: Link[];
}

export const ABOUT: Section = {
  id: 'landing-about',
  heading: 'About Darksight',
  paragraphs: [
    'Darksight compares lunar landing sites and dates side by side: when each one has sunlight ' +
      '(power) and a line of sight to Earth (radio), measured against the real terrain skyline.',
    'Every number is worked out in your browser, from a table of Sun and Earth positions ' +
      '(JPL DE440, through Skyfield) and a height map of the south pole (NASA LRO LOLA). ' +
      'The Moon has no atmosphere, so no refraction is applied.',
    'Built in 48 hours by Team GLYFT from Kuala Lumpur, for the NASA Space Apps Challenge 2026.',
  ],
  links: [
    { label: 'The challenge: Lunar Landing Site Navigator', href: CHALLENGE_URL },
    { label: 'Source code on GitHub', href: REPO_URL },
  ],
};

export interface Member {
  name: string;
  /** Path under web/public/, without a leading slash. */
  photo: string;
}

/** Team GLYFT, in the order of the team's name: G, L, Y, F, T. Full names, from the team. */
export const TEAM: Member[] = [
  { name: 'Go Yu An', photo: 'team/go-yu-an.jpg' },
  { name: 'Leon Ng', photo: 'team/leon-ng.jpg' },
  { name: 'Yeap Yi Hung', photo: 'team/yeap-yi-hung.jpg' },
  { name: 'Fabian Chuah', photo: 'team/fabian-chuah.jpg' },
  { name: 'Teh Hao Zhe', photo: 'team/teh-hao-zhe.jpg' },
];

export const PRIVACY: Section = {
  id: 'landing-privacy',
  heading: 'Privacy',
  paragraphs: [
    'Darksight is a set of static files. It has no accounts, no cookies, no analytics, no ' +
      'advertising and no trackers, and it sends nothing you do anywhere.',
    'Your browser keeps a copy of the Sun and Earth table in its own cache, so the next visit ' +
      'loads faster. You can clear it with your browser\'s site data. The site and time you pick ' +
      'are kept in the page address, so a link you share opens the same view.',
    'As with any website, the host that serves the files may keep standard access logs. ' +
      'Darksight itself collects no personal data.',
  ],
};

export const LICENSE: Section = {
  id: 'landing-license',
  heading: 'Licence',
  paragraphs: [
    'Darksight\'s code is open source under the MIT License, copyright 2026 GLYFT.',
    'The lunar data comes from NASA and is in the public domain. Every dataset and library used ' +
      'is cited in the repository and in the About panel inside the site.',
  ],
  links: [
    { label: 'MIT License', href: `${REPO_URL}/blob/main/LICENSE` },
    { label: 'Sources', href: `${REPO_URL}/tree/main/docs/sources` },
  ],
};

export const FOOTER_LINKS: Link[] = [
  { label: 'GitHub', href: REPO_URL },
  { label: 'NASA Space Apps 2026', href: CHALLENGE_URL },
];

export const COPYRIGHT = '© 2026 Team GLYFT · MIT License';
