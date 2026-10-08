'use strict';

const SKIN_TONES = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'];
const isSkinTone = point => point >= 0x1F3FB && point <= 0x1F3FF;
const sequenceKey = emoji => emoji.replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, '');

function nameWithoutSkinTones(name) {
  const [label, ...details] = name.split(': ');
  const remaining = details.join(': ').split(', ').filter(detail =>
    detail && !SKIN_TONES.some(tone => detail === `${tone} skin tone`));
  return remaining.length ? `${label}: ${remaining.join(', ')}` : label;
}

/** Parse Unicode emoji-test.txt into ordered categories and subgroups. */
function parseEmojiTest(text) {
  if (typeof text !== 'string') throw new TypeError('Expected emoji-test.txt text');

  const result = { version: null, categories: [] };
  let category;
  let subgroup;
  let count = 0;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;

    const version = line.match(/^# Version:\s*(\d+\.\d+)\s*$/);
    if (version) {
      result.version = version[1];
      continue;
    }
    const group = line.match(/^# group:\s*(.+)$/);
    if (group) {
      category = { name: group[1].trim(), subgroups: [] };
      result.categories.push(category);
      subgroup = undefined;
      continue;
    }
    const sub = line.match(/^# subgroup:\s*(.+)$/);
    if (sub) {
      if (!category) throw new Error(`Subgroup before category at line ${index + 1}`);
      subgroup = { name: sub[1].trim(), emojis: [] };
      category.subgroups.push(subgroup);
      continue;
    }
    if (line.startsWith('#')) continue;

    const entry = line.match(/^([0-9A-Fa-f]{4,6}(?:\s+[0-9A-Fa-f]{4,6})*)\s*;\s*(fully-qualified|minimally-qualified|unqualified|component)\s*#\s*(\S+)\s+E(\d+\.\d+)\s+(.+)$/);
    if (!entry) throw new Error(`Malformed emoji entry at line ${index + 1}`);
    if (!category || !subgroup) throw new Error(`Emoji without category/subgroup at line ${index + 1}`);

    const [, hex, status, displayedEmoji, emojiVersion, name] = entry;
    const points = hex.trim().split(/\s+/).map(value => Number.parseInt(value, 16));
    if (points.some(point => point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF))) {
      throw new Error(`Invalid Unicode code point at line ${index + 1}`);
    }
    const emoji = String.fromCodePoint(...points);
    if (emoji !== displayedEmoji) throw new Error(`Emoji/code point mismatch at line ${index + 1}`);
    if (status !== 'fully-qualified') continue;

    const keywords = [...new Set(name.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [])];
    const skinTones = points.filter(isSkinTone).map(point => SKIN_TONES[point - 0x1F3FB]);
    subgroup.emojis.push({ emoji, name, keywords, emojiVersion, skinTones, baseEmoji: null });
    count++;
  }

  if (!result.version) throw new Error('Missing Unicode emoji version');
  if (!count) throw new Error('No fully qualified emojis found');
  const emojis = result.categories.flatMap(group => group.subgroups.flatMap(sub => sub.emojis));
  const defaults = emojis.filter(entry => entry.skinTones.length === 0);
  const bySequence = new Map(defaults.map(entry => [sequenceKey(entry.emoji), entry.emoji]));
  const byName = new Map(defaults.map(entry => [entry.name, entry.emoji]));
  const byEmoji = new Map(defaults.map(entry => [entry.emoji, entry]));
  const nested = new Set();
  for (const entry of defaults) entry.variants = [];
  for (const entry of emojis) {
    // Resolve to an actual fully qualified entry, preserving presentation selectors.
    // Name lookup also covers legacy bases such as 🤝 whose mixed-tone form is a ZWJ sequence.
    entry.baseEmoji = entry.skinTones.length === 0 ? entry.emoji :
      bySequence.get(sequenceKey(entry.emoji)) ?? byName.get(nameWithoutSkinTones(entry.name)) ?? null;
    if (entry.skinTones.length > 0) {
      const base = byEmoji.get(entry.baseEmoji);
      if (base) {
        base.variants.push(entry);
        nested.add(entry);
      } else {
        // Preserve unmatched variants in partial or future datasets rather than losing them.
        entry.variants = [];
      }
    }
  }
  for (const group of result.categories) {
    for (const sub of group.subgroups) {
      sub.emojis = sub.emojis.filter(entry => !nested.has(entry));
    }
    group.subgroups = group.subgroups.filter(sub => sub.emojis.length > 0);
  }
  result.categories = result.categories.filter(group => group.subgroups.length > 0);
  return result;
}

module.exports = { parseEmojiTest };
