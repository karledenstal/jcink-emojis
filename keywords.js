'use strict';

const lookupKey = emoji => emoji.replace(/\uFE0F/g, '');
const words = text => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function annotationIndex(annotations, derived) {
  const index = new Map();
  for (const [document, root] of [[annotations, 'annotations'], [derived, 'annotationsDerived']]) {
    const container = document?.[root];
    const entries = container?.annotations;
    if (container?.identity?.language !== 'en' || !isObject(entries) || !Object.keys(entries).length) {
      throw new Error(`Invalid CLDR ${root}: expected nonempty English annotations`);
    }
    for (const [emoji, entry] of Object.entries(entries)) {
      if (!emoji || !isObject(entry) || !Array.isArray(entry.default) ||
          !entry.default.every(term => typeof term === 'string') ||
          (entry.tts !== undefined && (!Array.isArray(entry.tts) || !entry.tts.every(term => typeof term === 'string')))) {
        throw new Error(`Invalid CLDR ${root} entry for ${emoji}`);
      }
      const key = lookupKey(emoji);
      const terms = index.get(key) || new Set();
      for (const term of [...entry.default, ...(entry.tts || [])]) {
        for (const word of words(term)) terms.add(word);
      }
      index.set(key, terms);
    }
  }
  return index;
}

/** Enrich a parsed dataset in place. Both CLDR documents are validated before mutation. */
function enrichKeywords(data, annotations, derived) {
  const index = annotationIndex(annotations, derived);
  function enrich(entry, inherited = []) {
    entry.keywords = [...new Set([
      ...entry.keywords.flatMap(words),
      ...(index.get(lookupKey(entry.emoji)) || []),
      ...inherited,
    ])];
  }
  for (const category of data.categories) {
    for (const subgroup of category.subgroups) {
      for (const entry of subgroup.emojis) {
        enrich(entry);
        for (const variant of entry.variants) enrich(variant, entry.keywords);
      }
    }
  }
  return data;
}

module.exports = { enrichKeywords };
