'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, readdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseEmojiTest } = require('../index');
const { generate } = require('../generate');

const fixture = `# emoji-test.txt
# Version: 17.0
# group: Smileys & Emotion
# subgroup: face-smiling
1F600 ; fully-qualified # 😀 E1.0 grinning face
263A FE0F ; fully-qualified # ☺️ E0.6 smiling face
263A ; unqualified # ☺ E0.6 smiling face
# subgroup: face-neutral-skeptical
1F636 200D 1F32B FE0F ; fully-qualified # 😶‍🌫️ E13.1 face in clouds
1F636 200D 1F32B ; minimally-qualified # 😶‍🌫 E13.1 face in clouds
# group: People & Body
# subgroup: hand-fingers-closed
1F44D 1F3FD ; fully-qualified # 👍🏽 E1.0 thumbs up: medium skin tone
# group: Component
# subgroup: skin-tone
1F3FD ; component # 🏽 E1.0 medium skin tone
`;

test('preserves hierarchy/order and sequences while filtering alternative forms and components', () => {
  const data = parseEmojiTest(fixture);
  assert.equal(data.version, '17.0');
  assert.deepEqual(data.categories.map(group => group.name), ['Smileys & Emotion', 'People & Body']);
  assert.deepEqual(data.categories[0].subgroups.map(sub => sub.name), ['face-smiling', 'face-neutral-skeptical']);
  const emojis = data.categories.flatMap(group => group.subgroups.flatMap(sub => sub.emojis));
  assert.deepEqual(emojis.map(entry => entry.emoji), ['😀', '☺️', '😶‍🌫️', '👍🏽']);
  assert.deepEqual(emojis[0], { emoji: '😀', name: 'grinning face', keywords: ['grinning', 'face'], emojiVersion: '1.0', skinTones: [], baseEmoji: '😀', variants: [] });
  assert.equal(emojis[2].emojiVersion, '13.1');
  assert.deepEqual(emojis[3].keywords, ['thumbs', 'up', 'medium', 'skin', 'tone']);
  assert.deepEqual(emojis[3].skinTones, ['medium']);
  assert.equal(emojis[3].baseEmoji, null); // This fixture omits the unmodified thumbs up.
});

test('links all five tones to a base even when variants precede it', () => {
  const tones = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'];
  const rows = tones.map((tone, index) =>
    `1F44D ${(0x1F3FB + index).toString(16)} ; fully-qualified # ${String.fromCodePoint(0x1F44D, 0x1F3FB + index)} E1.0 thumbs up: ${tone} skin tone`);
  const data = parseEmojiTest(`# Version: 17.0\n# group: People & Body\n# subgroup: hands\n${rows.join('\n')}\n1F44D ; fully-qualified # 👍 E0.6 thumbs up`);
  const entries = data.categories[0].subgroups[0].emojis;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].emoji, '👍');
  assert.equal(entries[0].emojiVersion, '0.6');
  assert.deepEqual(entries[0].variants.map(entry => entry.skinTones), tones.map(tone => [tone]));
  assert.ok(entries[0].variants.every(entry => entry.baseEmoji === '👍' && entry.emojiVersion === '1.0'));
  assert.ok(entries[0].variants.every(entry => !Object.hasOwn(entry, 'variants')));
});

test('resolves presentation selectors, ZWJ professions and mixed-tone legacy bases', () => {
  const data = parseEmojiTest(`# Version: 17.0
# group: People & Body
# subgroup: examples
270C FE0F ; fully-qualified # ✌️ E0.6 victory hand
270C 1F3FB ; fully-qualified # ✌🏻 E1.0 victory hand: light skin tone
1F469 200D 2695 FE0F ; fully-qualified # 👩‍⚕️ E4.0 woman health worker
1F469 1F3FD 200D 2695 FE0F ; fully-qualified # 👩🏽‍⚕️ E4.0 woman health worker: medium skin tone
1F91D ; fully-qualified # 🤝 E3.0 handshake
1FAF1 1F3FB 200D 1FAF2 1F3FF ; fully-qualified # 🫱🏻‍🫲🏿 E14.0 handshake: light skin tone, dark skin tone
1F9D1 200D 1F91D 200D 1F9D1 ; fully-qualified # 🧑‍🤝‍🧑 E12.0 people holding hands
1F9D1 1F3FD 200D 1F91D 200D 1F9D1 1F3FD ; fully-qualified # 🧑🏽‍🤝‍🧑🏽 E12.0 people holding hands: medium skin tone
`);
  const entries = data.categories[0].subgroups[0].emojis;
  assert.deepEqual(entries.map(entry => entry.emoji), ['✌️', '👩‍⚕️', '🤝', '🧑‍🤝‍🧑']);
  assert.equal(entries[0].variants[0].baseEmoji, '✌️');
  assert.equal(entries[1].variants[0].baseEmoji, '👩‍⚕️');
  assert.equal(entries[2].variants[0].baseEmoji, '🤝');
  assert.deepEqual(entries[2].variants[0].skinTones, ['light', 'dark']);
  assert.equal(entries[2].emojiVersion, '3.0');
  assert.equal(entries[2].variants[0].emojiVersion, '14.0');
  assert.equal(entries[3].variants[0].baseEmoji, '🧑‍🤝‍🧑');
  assert.deepEqual(entries[3].variants[0].skinTones, ['medium', 'medium']);
});

test('grouping retains every entry exactly once and removes subgroups emptied by grouping', () => {
  const data = parseEmojiTest(fixture.replace('# group: Component', `# subgroup: base-hands
1F44D ; fully-qualified # 👍 E0.6 thumbs up
# group: Component`));
  const people = data.categories[1];
  assert.deepEqual(people.subgroups.map(sub => sub.name), ['base-hands']);
  const entries = data.categories.flatMap(group => group.subgroups.flatMap(sub => sub.emojis));
  const all = entries.flatMap(entry => [entry, ...entry.variants]);
  assert.equal(all.length, 5);
  assert.equal(new Set(all.map(entry => entry.emoji)).size, 5);
  assert.equal(people.subgroups[0].emojis[0].variants[0].emoji, '👍🏽');
});

test('supports CRLF, BOM, punctuation and deduplicated lowercase keywords', () => {
  const input = '\uFEFF' + fixture.replace('grinning face', 'Face: face—SMILE, heart-eyes!').replaceAll('\n', '\r\n');
  assert.deepEqual(parseEmojiTest(input).categories[0].subgroups[0].emojis[0].keywords,
    ['face', 'smile', 'heart', 'eyes']);
});

test('rejects malformed or empty data and misplaced entries', () => {
  assert.throws(() => parseEmojiTest(''), /version/);
  assert.throws(() => parseEmojiTest('# Version: 17.0'), /No fully qualified/);
  assert.throws(() => parseEmojiTest(fixture.replace('1F600 ;', 'INVALID ;')), /Malformed/);
  assert.throws(() => parseEmojiTest(fixture.replace('1F600 ;', '110000 ;')), /Invalid Unicode/);
  assert.throws(() => parseEmojiTest(fixture.replace('1F600 ;', '1F601 ;')), /mismatch/);
  assert.throws(() => parseEmojiTest(fixture.replace('# group: Smileys & Emotion\n', '')), /Subgroup before/);
  assert.throws(() => parseEmojiTest(fixture.replace('# subgroup: face-smiling\n', '')), /without category/);
});

test('generator writes JSON and preserves existing output on download or parse failure', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jcink-emojis-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'emojis.json');
  await writeFile(outputPath, 'existing output');
  for (const fetchImpl of [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('invalid data'),
    async () => { throw new DOMException('Timed out', 'TimeoutError'); },
  ]) {
    await assert.rejects(generate({ outputPath, fetchImpl }));
    assert.equal(await readFile(outputPath, 'utf8'), 'existing output');
  }
  await generate({ outputPath, fetchImpl: async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url === 'https://unicode.org/Public/emoji/latest/emoji-test.txt') return new Response(fixture);
    const root = url.includes('annotationsDerived') ? 'annotationsDerived' : 'annotations';
    return Response.json({ [root]: { identity: { language: 'en' }, annotations: { '😀': { default: ['grinning', 'face'] } } } });
  } });
  const output = await readFile(outputPath, 'utf8');
  assert.deepEqual(JSON.parse(output), parseEmojiTest(fixture));
  assert.equal(output, JSON.stringify(parseEmojiTest(fixture)));
  assert.ok(Buffer.byteLength(output) < Buffer.byteLength(JSON.stringify(parseEmojiTest(fixture), null, 2)));
  assert.deepEqual(await readdir(directory), ['emojis.json']);
});
