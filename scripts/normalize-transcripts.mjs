/**
 * Post-processes all transcripts in data/comics.json to enforce a consistent
 * style and remove unwanted comparisons (e.g. "XKCD style", "SMBC style").
 *
 * Text-only — no image API calls. Fast and cheap.
 *
 * Usage:
 *   node --env-file=.env scripts/normalize-transcripts.mjs
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUTPUT_FILE = join(ROOT, 'data', 'comics.json');

const NORMALIZE_PROMPT = `You are editing a webcomic transcript for consistency and accuracy.

Rewrite the transcript to follow this exact structure:
1. Scene: One or two sentences describing the setting, characters, and visual style. Do NOT compare to other webcomics (remove any references to XKCD, SMBC, or similar).
2. Text: All dialogue, captions, labels, and equations transcribed exactly and in reading order.
3. Visual note: (only if there is a visual joke or pun that depends on the image — omit this section otherwise)

Rules:
- Use plain, neutral language throughout
- Preserve all exact quoted text verbatim
- Keep it concise — remove filler and redundant phrasing
- Do not add information that isn't in the original transcript

Output only the rewritten transcript, no preamble.`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function normalize(client, transcript, comicNumber, retrying = false) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${NORMALIZE_PROMPT}\n\n---\n\n${transcript}`,
      }],
    });
    return response.content[0].text.trim();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError && !retrying) {
      console.warn(`  Rate limited on #${comicNumber}, waiting 60s...`);
      await sleep(60_000);
      return normalize(client, transcript, comicNumber, true);
    }
    console.error(`  Failed to normalize #${comicNumber}: ${err.message}`);
    return transcript; // keep original on failure
  }
}

const data = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
const toProcess = data.comics.filter(c => c.transcript && c.transcript.length > 0);
console.log(`Normalizing ${toProcess.length} transcripts...`);

const client = new Anthropic();
let done = 0;

for (const entry of toProcess) {
  entry.transcript = await normalize(client, entry.transcript, entry.number);
  done++;
  await sleep(100);

  if (done % 50 === 0) {
    writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`Progress: ${done} / ${toProcess.length}`);
  }
}

writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
console.log(`\nDone. Normalized ${done} transcripts.`);
