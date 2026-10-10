'use strict';

const { writeFile, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseEmojiTest } = require('./index');
const { enrichKeywords } = require('./keywords');

const SOURCE_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';
const CLDR_ROOT = 'https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json';
const ANNOTATIONS_URL = `${CLDR_ROOT}/cldr-annotations-full/annotations/en/annotations.json`;
const DERIVED_URL = `${CLDR_ROOT}/cldr-annotations-derived-full/annotationsDerived/en/annotations.json`;

async function generate({ fetchImpl = fetch, outputPath = path.join(__dirname, 'emojis.json') } = {}) {
  async function download(url, format) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Unicode download failed: HTTP ${response.status} (${url})`);
    return format === 'text' ? response.text() : response.json();
  }
  const [text, annotations, derived] = await Promise.all([
    download(SOURCE_URL, 'text'),
    download(ANNOTATIONS_URL, 'json'),
    download(DERIVED_URL, 'json'),
  ]);
  const data = enrichKeywords(parseEmojiTest(text), annotations, derived);
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(data), { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return data;
}

if (require.main === module) {
  generate().then(data => {
    const count = data.categories.reduce((total, category) =>
      total + category.subgroups.reduce((sum, subgroup) =>
        sum + subgroup.emojis.reduce((entries, entry) => entries + 1 + entry.variants.length, 0), 0), 0);
    console.log(`Wrote ${count} emojis in ${data.categories.length} categories to emojis.json (Unicode ${data.version}).`);
  }).catch(error => {
    console.error(`Emoji generation failed: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
    process.exitCode = 1;
  });
}

module.exports = { generate };
