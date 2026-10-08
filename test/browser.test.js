'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { parseEmojiTest } = require('../index');

const script = readFileSync(require.resolve('../browser/emoji.js'), 'utf8');
const toneNames = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'];
const toneRows = toneNames.map((tone, i) =>
  `1F44D ${(0x1F3FB + i).toString(16)} ; fully-qualified # ${String.fromCodePoint(0x1F44D, 0x1F3FB + i)} E1.0 thumbs up: ${tone} skin tone`);
const fixture = parseEmojiTest(`# Version: 17.0
# group: Smileys & Emotion
# subgroup: face-smiling
1F600 ; fully-qualified # 😀 E1.0 grinning face
1F603 ; fully-qualified # 😃 E0.6 grinning face with big eyes
1F63A ; fully-qualified # 😺 E0.6 grinning cat
# group: People & Body
# subgroup: hands
1F44D ; fully-qualified # 👍 E0.6 thumbs up
${toneRows.join('\n')}
1F91D ; fully-qualified # 🤝 E3.0 handshake
1FAF1 1F3FB 200D 1FAF2 1F3FF ; fully-qualified # 🫱🏻‍🫲🏿 E14.0 handshake: light skin tone, dark skin tone
1F9D1 200D 1F91D 200D 1F9D1 ; fully-qualified # 🧑‍🤝‍🧑 E12.0 people holding hands
1F9D1 1F3FD 200D 1F91D 200D 1F9D1 1F3FD ; fully-qualified # 🧑🏽‍🤝‍🧑🏽 E12.0 people holding hands: medium skin tone
270C 1F3FB ; fully-qualified # ✌🏻 E1.0 victory hand: light skin tone
`);

function load(fetchImpl = async () => Response.json(fixture), document = { baseURI: 'https://forum.example/browser/demo.html' }) {
  const context = vm.createContext({ URL, AbortSignal, document, fetch: fetchImpl });
  context.window = context;
  vm.runInContext(script, context);
  return context;
}

const plain = value => JSON.parse(JSON.stringify(value));

test('browser init shares pending/completed requests and prevents dataset switching', async () => {
  let calls = 0;
  let release;
  const context = load(async (url, options) => {
    calls++;
    assert.equal(url, 'https://forum.example/emojis.json');
    assert.ok(options.signal instanceof AbortSignal);
    await new Promise(resolve => { release = resolve; });
    return Response.json(fixture);
  });
  const { Emoji } = context;
  assert.throws(() => Emoji.search('face'), /not ready/);
  const first = Emoji.init('../emojis.json');
  assert.equal(first, Emoji.init('/emojis.json'));
  await assert.rejects(Emoji.init('/another.json'), /another URL/);
  assert.throws(() => Emoji.search('face'), /not ready/);
  release();
  await first;
  assert.equal(Emoji.init('/emojis.json'), first);
  await assert.rejects(Emoji.init('/another.json'), /another URL/);
  assert.equal(calls, 1);
  assert.equal(Emoji.search('face').length, 2);
});

test('initialization failures remain retryable without exposing partial data', async () => {
  const failures = [
    async () => { throw new Error('Network unavailable'); },
    async () => new Response('', { status: 503 }),
    async () => new Response('not json'),
    async () => Response.json({ version: '17.0', categories: [] }),
    async () => Response.json({ version: '17.0', categories: [{ name: 'bad', subgroups: null }] }),
    async () => {
      const malformed = structuredClone(fixture);
      malformed.categories[1].subgroups[0].emojis[0].variants[0].skinTones = ['invalid'];
      return Response.json(malformed);
    },
  ];
  for (const failure of failures) {
    let attempts = 0;
    const { Emoji } = load(() => ++attempts === 1 ? failure() : Response.json(fixture));
    await assert.rejects(Emoji.init('/emojis.json'));
    assert.throws(() => Emoji.search(''), /not ready/);
    await Emoji.init('/emojis.json');
    assert.equal(Emoji.search('thumbs').length, 1);
  }
  const { Emoji } = load();
  for (const url of ['', null, 'file:///tmp/emojis.json']) {
    await assert.rejects(Emoji.init(url), /URL/);
  }
});

test('search normalizes words, requires every prefix, ranks exact matches and preserves ties', async () => {
  const data = structuredClone(fixture);
  const entries = data.categories[0].subgroups[0].emojis;
  entries.reverse(); // Put the exact name after a longer match to exercise ranking.
  entries[0].keywords.push('happy');
  const { Emoji } = load(async () => Response.json(data));
  await Emoji.init('/emojis.json');
  assert.equal(Emoji.search(' GRINNING—FACE!! ')[0].emoji, '😀');
  assert.deepEqual(plain(Emoji.search('grin fa').map(entry => entry.emoji)), ['😃', '😀']);
  assert.equal(Emoji.search('grin cat')[0].emoji, '😺');
  assert.equal(Emoji.search('HAPPY')[0].emoji, '😺');
  assert.equal(Emoji.search('ＴＨＵＭＢＳ up')[0].emoji, '👍');
  assert.equal(Emoji.search('thumb missing').length, 0);
  assert.equal(Emoji.search('thums').length, 0);
  assert.equal(Emoji.search('rin').length, 0);
  // Exact word match outranks a prefix regardless of source ordering.
  entries[0].keywords.push('grin');
  const second = load(async () => Response.json(data)).Emoji;
  await second.init('/emojis.json');
  assert.equal(second.search('grin')[0].emoji, '😺');
});

test('empty queries, categories, limits, and invalid search arguments', async () => {
  const { Emoji } = load();
  await Emoji.init('/emojis.json');
  assert.deepEqual(plain(Emoji.search('  ').slice(0, 3).map(entry => entry.emoji)), ['😀', '😃', '😺']);
  assert.equal(Emoji.search('!!!', null, { limit: 2 }).length, 2);
  assert.equal(Emoji.search('', null, { limit: 0 }).length, 0);
  assert.equal(Emoji.search('', null, { category: 'People & Body' }).length, 4);
  assert.equal(Emoji.search('grin', null, { category: 'People & Body' }).length, 0);
  assert.equal(Emoji.search('', null, { category: 'people & body' }).length, 0);
  for (const limit of [-1, 1.5, Infinity, '10', NaN]) {
    assert.throws(() => Emoji.search('', null, { limit }), /limit/);
  }
  assert.throws(() => Emoji.search(null), /query/);
  assert.throws(() => Emoji.search('', 'purple'), /skin tone/);
  assert.throws(() => Emoji.search('', null, null), /options/);
  assert.throws(() => Emoji.search('', null, { category: 1 }), /category/);

  const large = structuredClone(fixture);
  large.categories[0].subgroups[0].emojis = Array.from({ length: 60 }, (_, i) => ({
    ...structuredClone(fixture.categories[0].subgroups[0].emojis[0]), name: `face ${i}`,
  }));
  const more = load(async () => Response.json(large)).Emoji;
  await more.init('/emojis.json');
  assert.equal(more.search('').length, 50);
});

test('tone selection returns variant metadata, falls back, and preserves mixed-tone variants', async () => {
  const { Emoji } = load();
  await Emoji.init('/emojis.json');
  for (const [i, tone] of toneNames.entries()) {
    const matches = Emoji.search('thumb', tone);
    assert.equal(matches.length, 1);
    const match = matches[0];
    assert.equal(match.emoji, String.fromCodePoint(0x1F44D, 0x1F3FB + i));
    assert.equal(match.name, `thumbs up: ${tone} skin tone`);
    assert.equal(match.emojiVersion, '1.0');
    assert.equal(match.baseEmoji, '👍');
    assert.equal(match.category, 'People & Body');
    assert.equal(match.subgroup, 'hands');
    assert.equal(match.variants.length, 5);
  }
  assert.equal(Emoji.search('thumb')[0].emojiVersion, '0.6');
  assert.equal(Emoji.search('grinning face', 'dark')[0].emoji, '😀');
  const handshake = Emoji.search('handshake', 'light')[0];
  assert.equal(handshake.emoji, '🤝');
  assert.deepEqual(plain(handshake.variants[0].skinTones), ['light', 'dark']);
  assert.equal(Emoji.search('people holding', 'medium')[0].emoji, '🧑🏽‍🤝‍🧑🏽');
  assert.equal(Emoji.search('victory')[0].baseEmoji, null);
});

test('returned objects and nested arrays cannot mutate the index or later results', async () => {
  const { Emoji } = load();
  await Emoji.init('/emojis.json');
  const expected = plain(Emoji.search('thumb', 'medium'));
  const result = Emoji.search('thumb', 'medium')[0];
  result.emoji = 'changed';
  result.keywords.push('broken');
  result.skinTones[0] = 'dark';
  result.variants[0].emoji = 'changed';
  result.variants[0].keywords.length = 0;
  result.variants[0].skinTones.length = 0;
  result.variants.pop();
  assert.deepEqual(plain(Emoji.search('thumb', 'medium')), expected);
  assert.equal(Emoji.search('broken').length, 0);
});

// Execute the actual demo script against a minimal DOM to exercise its event wiring
// and text-only rendering without adding a browser/runtime dependency.
function demoDocument() {
  function element() {
    return { value: '', disabled: true, textContent: '', children: [], events: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(name, callback) { this.events[name] = callback; } };
  }
  const elements = Object.fromEntries(['query', 'tone', 'status', 'results'].map(id => [id, element()]));
  return { elements, baseURI: 'https://forum.example/browser/demo.html',
    getElementById: id => elements[id], createElement: element };
}

test('HTML demo loads local fixture, responds to inputs, and shows empty and error states', async () => {
  const html = readFileSync(require.resolve('../browser/demo.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const document = demoDocument();
  const context = load(undefined, document);
  vm.runInContext(inline, context);
  await context.Emoji.init('../emojis.json');
  await new Promise(resolve => setImmediate(resolve));
  const { query, tone, status, results } = document.elements;
  assert.equal(query.disabled, false);
  assert.ok(results.children.length > 0);
  query.value = 'thumb';
  tone.value = 'medium';
  tone.events.change();
  assert.equal(results.children[0].children[0].textContent, '👍🏽');
  query.value = '<script>missing</script>';
  query.events.input();
  assert.equal(results.children.length, 0);
  assert.equal(status.textContent, 'No matching emojis.');

  const failedDocument = demoDocument();
  const failed = load(async () => new Response('', { status: 503 }), failedDocument);
  vm.runInContext(inline, failed);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(failedDocument.elements.status.textContent, /Could not load emojis:.*503/);
  assert.equal(failedDocument.elements.query.disabled, true);
});
