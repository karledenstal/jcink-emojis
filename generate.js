'use strict';

const { writeFile, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseEmojiTest } = require('./index');

const SOURCE_URL = 'https://unicode.org/Public/emoji/latest/emoji-test.txt';

async function generate({ fetchImpl = fetch, outputPath = path.join(__dirname, 'emojis.json') } = {}) {
  const response = await fetchImpl(SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Unicode download failed: HTTP ${response.status}`);
  const data = parseEmojiTest(await response.text());
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
