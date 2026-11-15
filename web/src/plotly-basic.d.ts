// Plotly's basic build (scatter, bar and pie: every chart this site draws) ships no types of its
// own. Its API is the full build's, so it takes the types the full build ships. The full build is
// a dev dependency for these types only and is never bundled.
declare module 'plotly.js-basic-dist-min' {
  export * from 'plotly.js-dist-min';
  export { default } from 'plotly.js-dist-min';
}
