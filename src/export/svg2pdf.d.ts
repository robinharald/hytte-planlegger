// The ES build of svg2pdf.js, imported by path so that Vite (browser) and Vitest (Node, where the package's "main"
// is a UMD bundle expecting a global jsPDF) load the same module. Same API as the package entry.
declare module 'svg2pdf.js/dist/svg2pdf.es.min.js' {
  export { svg2pdf } from 'svg2pdf.js';
}
