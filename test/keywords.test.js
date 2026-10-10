'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { parseEmojiTest } = require('../index');
const { enrichKeywords } = require('../keywords');
const { generate } = require('../generate');

const source = `# Version: 17.0
# group: People & Body
# subgroup: hands
1F44D ; fully-qualified # 👍 E0.6 thumbs up
1F44D 1F3FD ; fully-qualified # 👍🏽 E1.0 thumbs up: medium skin tone
1F44D 1F3FF ; fully-qualified # 👍🏿 E1.0 thumbs up: dark skin tone
270C FE0F ; fully-qualified # ✌️ E0.6 victory hand
1F469 200D 2695 FE0F ; fully-qualified # 👩‍⚕️ E4.0 woman health worker
1F600 ; fully-qualified # 😀 E1.0 grinning face
`;
const document = (root, entries) => ({ [root]: { identity: { language: 'en' }, annotations: entries } });
const annotations = document('annotations', {
  '👍': { default: ['THUMBS', 'ＡＰＰＲＯＶＡＬ', 'well-done', 'approval'], tts: ['positive gesture'] },
  '✌': { default: ['peace sign'], tts: ['victory hand'] },
});
const derived = document('annotationsDerived', {
  '👍🏽': { default: ['medium-only'], tts: ['thumbs up: medium skin tone'] },
  '👩‍⚕': { default: ['doctor', 'health care'], tts: ['woman health worker'] },
});
const entries = data => data.categories[0].subgroups[0].emojis;

test('CLDR enriches names, phrases, selectors and derived sequences without crossing tone boundaries', () => {
  const data = parseEmojiTest(source);
  const original = structuredClone(data);
  enrichKeywords(data, annotations, derived);
  const [thumb, victory, doctor, missing] = entries(data);
  assert.deepEqual(thumb.keywords, ['thumbs', 'up', 'approval', 'well', 'done', 'positive', 'gesture']);
  assert.ok(victory.keywords.includes('peace'));
  assert.ok(doctor.keywords.includes('doctor'));
  assert.ok(doctor.keywords.includes('care'));
  assert.ok(thumb.variants[0].keywords.includes('only'));
  assert.ok(!thumb.variants[1].keywords.includes('only'));
  assert.ok(!thumb.keywords.includes('only'));
  assert.ok(thumb.variants.every(variant => variant.keywords.includes('approval')));
  assert.deepEqual(missing.keywords, entries(original)[3].keywords);
  for (const [i, entry] of entries(data).entries()) {
    const all = [entry, ...entry.variants];
    const before = [entries(original)[i], ...entries(original)[i].variants];
    all.forEach((item, j) => {
      const { keywords, variants, ...other } = item;
      const { keywords: oldKeywords, variants: oldVariants, ...oldOther } = before[j];
      assert.deepEqual(other, oldOther);
      assert.equal(new Set(keywords).size, keywords.length);
    });
  }
});

test('rejects malformed CLDR before changing the parsed dataset', () => {
  for (const bad of [null, {}, document('annotationsDerived', {}),
    document('annotationsDerived', { '👍': { default: 'approval' } }),
    document('annotationsDerived', { '👍': { default: [42] } }),
    document('annotationsDerived', { '👍': { default: [], tts: 'thumb' } }),
    { annotationsDerived: { identity: { language: 'sv' }, annotations: { '👍': { default: ['bra'] } } } },
  ]) {
    const data = parseEmojiTest(source);
    assert.throws(() => enrichKeywords(data, annotations, bad), /Invalid CLDR/);
    assert.deepEqual(data, parseEmojiTest(source));
  }
});

test('generator fetches all sources concurrently, preserves output on CLDR failures, and feeds browser search', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emoji-keywords-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'emojis.json');
  const responseFor = url => url.endsWith('emoji-test.txt') ? new Response(source) :
    Response.json(url.includes('annotationsDerived') ? derived : annotations);
  await writeFile(outputPath, 'existing data');
  for (const target of ['annotations/en/', 'annotationsDerived/en/']) {
    for (const fail of [() => new Response('', { status: 503 }), () => new Response('not json'),
      () => Response.json({}), () => { throw new DOMException('Timed out', 'TimeoutError'); }]) {
      await assert.rejects(generate({ outputPath, fetchImpl: async url =>
        url.includes(target) ? fail() : responseFor(url) }));
      assert.equal(await readFile(outputPath, 'utf8'), 'existing data');
    }
  }
  const pending = [];
  const generation = generate({ outputPath, fetchImpl: (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return new Promise(resolve => pending.push({ url, resolve }));
  } });
  assert.equal(pending.length, 3);
  assert.equal(new Set(pending.map(item => item.url)).size, 3);
  for (const { url, resolve } of pending) resolve(responseFor(url));
  const data = await generation;
  assert.equal(await readFile(outputPath, 'utf8'), JSON.stringify(data));

  const context = vm.createContext({ URL, AbortSignal, document: { baseURI: 'https://example.test/' },
    fetch: async () => Response.json(data) });
  context.window = context;
  vm.runInContext(await readFile(require.resolve('../browser/emoji.js'), 'utf8'), context);
  await context.Emoji.init('/emojis.json');
  assert.equal(context.Emoji.search('approval', 'medium')[0].emoji, '👍🏽');
  assert.equal(context.Emoji.search('peace')[0].emoji, '✌️');
  assert.equal(context.Emoji.search('doctor')[0].emoji, '👩‍⚕️');
});
