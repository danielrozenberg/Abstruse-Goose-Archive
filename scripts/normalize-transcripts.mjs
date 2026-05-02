/**
 * Re-normalizes all transcripts in data/comics.json.
 * Converts them to a consistent structured format: { scene, text, visualNote }.
 * Text-only — no image API calls.
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

const NORMALIZE_PROMPT =
  'You are editing a webcomic transcript for consistency and accuracy.\n\n' +
  'Output a JSON object with exactly these three fields (no markdown code fences, no preamble):\n' +
  '{\n' +
  '  "scene": "1-2 sentences: setting, characters, visual style. No comparisons to other webcomics like XKCD or SMBC.",\n' +
  '  "text": "All dialogue, captions, labels, and equations verbatim in reading order. Preserve newlines between panels.",\n' +
  '  "visualNote": "Visual jokes or puns that require seeing the image. Empty string if none."\n' +
  '}\n\n' +
  'Rules: neutral language, exact quoted text verbatim, concise, do not add information not in the original.';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function flattenTranscript(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return [t.scene, t.text, t.visualNote].filter(Boolean).join('\n\n');
}

function parseJsonResponse(raw) {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      scene: String(parsed.scene ?? '').trim(),
      text: String(parsed.text ?? '').trim(),
      visualNote: String(parsed.visualNote ?? '').trim(),
    };
  } catch {
    return { scene: '', text: raw.trim(), visualNote: '' };
  }
}

async function normalize(client, entry, retrying = false) {
  const inputText = flattenTranscript(entry.transcript);
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${NORMALIZE_PROMPT}\n\n---\n\n${inputText}` }],
    });
    return parseJsonResponse(response.content[0].text.trim());
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError && !retrying) {
      console.warn(`  Rate limited on #${entry.number}, waiting 60s…`);
      await sleep(60_000);
      return normalize(client, entry, true);
    }
    console.error(`  Failed to normalize #${entry.number}: ${err.message}`);
    // Keep existing — coerce to object if needed
    return typeof entry.transcript === 'object'
      ? entry.transcript
      : { scene: '', text: entry.transcript ?? '', visualNote: '' };
  }
}

const data = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
const toProcess = data.comics.filter(c => flattenTranscript(c.transcript).length > 0);
console.log(`Normalizing ${toProcess.length} transcripts…`);

const client = new Anthropic();
let done = 0;

for (const entry of toProcess) {
  entry.transcript = await normalize(client, entry);
  done++;
  await sleep(100);

  if (done % 50 === 0) {
    writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`Progress: ${done} / ${toProcess.length}`);
  }
}

writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
console.log(`\nDone. Normalized ${done} transcripts.`);
