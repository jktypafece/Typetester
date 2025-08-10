// generate-specimen.js
// Generates an HTML specimen from fonts/ and renders PDF + PNG using Puppeteer.

// Usage expects environment variables (but also has reasonable defaults):
//  - FONT_DIR (default ./fonts)
//  - SPECIMEN_OUTPUT_DIR (default ./specimen-output)
//  - SAMPLE_TEXT (sample paragraph / pangram)

const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const mustache = require('mustache');
const puppeteer = require('puppeteer');

const FONT_DIR = process.env.FONT_DIR || './fonts';
const OUT_DIR = process.env.SPECIMEN_OUTPUT_DIR || './specimen-output';
const SAMPLE_TEXT = process.env.SAMPLE_TEXT || 'The quick brown fox jumps over the lazy dog';

async function findFonts(dir) {
  const exts = ['ttf','otf','woff','woff2','eot'];
  const patterns = exts.map(ext => path.join(dir, `**/*.${ext}`));
  const files = patterns.flatMap(p => glob.sync(p));
  return files;
}

function fontFaceCSS(fontFiles) {
  // Create @font-face rules from filenames.
  // We will infer family name from file base name; users can customize later.
  return fontFiles.map((f, index) => {
    const filename = path.basename(f);
    // sanitize family name
    const family = filename.replace(/\.[^/.]+$/, '').replace(/[_\-]/g, ' ');
    const relPath = path.posix.join('/fonts', filename);
    return `
@font-face {
  font-family: "${family}";
  src: url("${relPath}") format("${path.extname(filename).slice(1)}");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;
  }).join('\n');
}

async function copyFonts(fontFiles) {
  await fs.ensureDir(path.join(OUT_DIR, 'fonts'));
  for (const f of fontFiles) {
    const dest = path.join(OUT_DIR, 'fonts', path.basename(f));
    await fs.copyFile(f, dest);
  }
}

async function renderWithPuppeteer(htmlPath, outBase) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // load local file
  await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle0' });

  // render PDF
  const pdfPath = outBase + '.pdf';
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
  });

  // render full-page PNG
  const pngPath = outBase + '.png';
  await page.screenshot({ path: pngPath, fullPage: true });

  await browser.close();
  return { pdfPath, pngPath };
}

async function main() {
  await fs.remove(OUT_DIR);
  await fs.ensureDir(OUT_DIR);

  const fonts = await findFonts(FONT_DIR);
  if (fonts.length === 0) {
    console.log('No fonts found in', FONT_DIR, '- putting a reminder file.');
    await fs.writeFile(path.join(OUT_DIR, 'README.txt'), 'Put your font files in the `fonts/` folder and run the workflow again.');
    return;
  }

  // copy fonts to output so specimen HTML can load them relative to file://
  await copyFonts(fonts);

  const css = fontFaceCSS(fonts.map(f => path.join(OUT_DIR,'fonts',path.basename(f))));
  const template = await fs.readFile(path.join(__dirname, '..', 'templates', 'specimen.html'), 'utf8');

  // prepare font samples list
  const fontSamples = fonts.map(f => {
    const filename = path.basename(f);
    const family = filename.replace(/\.[^/.]+$/, '').replace(/[_\-]/g, ' ');
    return { family, filename };
  });

  const view = {
    css,
    sampleText: SAMPLE_TEXT,
    fonts: fontSamples,
    date: new Date().toISOString().split('T')[0]
  };

  const html = mustache.render(template, view);
  const outHtmlPath = path.join(OUT_DIR, 'specimen.html');
  await fs.writeFile(outHtmlPath, html, 'utf8');

  console.log('Specimen generated at', outHtmlPath);

  // render to PDF + PNG
  const outBase = path.join(OUT_DIR, 'specimen');
  const { pdfPath, pngPath } = await renderWithPuppeteer(outHtmlPath, outBase);

  console.log('Rendered:', pdfPath, pngPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
