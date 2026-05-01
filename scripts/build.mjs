import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const COMICS_DIR = join(ROOT, 'comics');
const OUTPUT_FILE = join(ROOT, 'data', 'comics.json');
const FORCE = process.argv.includes('--force');

const TRANSCRIPT_PROMPT =
  'You are transcribing a webcomic for accessibility and search purposes. ' +
  'Provide: (1) a brief scene description (setting, characters, visual style — do NOT compare to other webcomics like XKCD or SMBC), ' +
  '(2) the exact text of all dialogue, captions, labels, and equations in reading order, ' +
  '(3) any visual jokes or puns that depend on the image itself. ' +
  'Be thorough but concise. Start with the scene description, then transcribe text in reading order.';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseMd(filepath) {
  const raw = readFileSync(filepath, 'utf8');
  const number = parseInt(basename(filepath, '.md'), 10);

  const titleMatch = raw.match(/^## (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `Comic ${number}`;

  const imageMatch = raw.match(/!\[image\]\((.+?)\)/);
  const image = imageMatch ? imageMatch[1].trim() : '';
  const imageExists = image !== '' && existsSync(join(COMICS_DIR, image));

  let commentHtml = '';
  const commentIdx = raw.indexOf('### Comment');
  if (commentIdx !== -1) {
    commentHtml = raw.slice(commentIdx + '### Comment'.length).trim();
  }
  const comment = stripHtml(commentHtml);

  return { number, title, image, imageExists, comment, commentHtml };
}

async function generateTranscript(client, meta, retrying = false) {
  const imagePath = join(COMICS_DIR, meta.image);
  const imageBytes = readFileSync(imagePath);
  const base64Data = imageBytes.toString('base64');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Data } },
          { type: 'text', text: TRANSCRIPT_PROMPT },
        ],
      }],
    });
    return response.content[0].text.trim();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError && !retrying) {
      console.warn(`  Rate limited on comic #${meta.number}, waiting 60s...`);
      await sleep(60_000);
      return generateTranscript(client, meta, true);
    }
    console.error(`  Failed to transcribe comic #${meta.number}: ${err.message}`);
    return '';
  }
}

function buildOutput(comics) {
  return JSON.stringify(
    { generated: new Date().toISOString(), count: comics.length, comics },
    null,
    2,
  );
}

async function main() {
  // Load existing data for idempotency
  const existingMap = new Map();
  if (!FORCE && existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
    for (const entry of existing.comics) {
      existingMap.set(entry.number, entry);
    }
    console.log(`Loaded ${existingMap.size} existing entries from comics.json`);
  }

  // Discover and parse all individual comic .md files
  const mdFiles = readdirSync(COMICS_DIR)
    .filter(f => /^\d+\.md$/.test(f))
    .map(f => join(COMICS_DIR, f));

  const comicsMeta = mdFiles.map(parseMd);
  comicsMeta.sort((a, b) => a.number - b.number);
  console.log(`Found ${comicsMeta.length} comics`);

  const client = new Anthropic();
  const results = [];
  let skipped = 0;
  let generated = 0;

  for (const meta of comicsMeta) {
    const existing = existingMap.get(meta.number);
    let transcript = '';

    if (!meta.imageExists) {
      transcript = '';
    } else if (existing?.transcript) {
      transcript = existing.transcript;
      skipped++;
    } else {
      process.stdout.write(`  Transcribing #${meta.number} "${meta.title}"...`);
      transcript = await generateTranscript(client, meta);
      process.stdout.write(' done\n');
      generated++;
      await sleep(200);
    }

    results.push({ ...meta, transcript });

    if (results.length % 25 === 0) {
      writeFileSync(OUTPUT_FILE, buildOutput(results));
      console.log(`Progress: ${results.length} / ${comicsMeta.length} (${skipped} skipped, ${generated} generated)`);
    }
  }

  writeFileSync(OUTPUT_FILE, buildOutput(results));
  console.log(`\nDone. ${results.length} comics total. ${skipped} skipped, ${generated} generated.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
