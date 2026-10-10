# jcink-emojis

Generate categorized emoji JSON from Unicode's [emoji-test.txt](https://unicode.org/Public/emoji/latest/emoji-test.txt), enriched with English CLDR search keywords. Requires Node.js 22 or newer; no dependencies to install.

```sh
npm run generate
npm test
```

## Browser search on Jcink

Upload `browser/emoji.js` and the generated `emojis.json` to your website. The browser library is separate from the Node parser and needs no framework or build step. Use the uploaded files' HTTPS URLs (or relative URLs if they share the page's origin):

```html
<script src="https://your-host.example/emoji.js"></script>
<script>
  async function startEmojiSearch() {
    try {
      await Emoji.init('https://your-host.example/emojis.json');
      const matches = Emoji.search('thumbs up', 'medium', { limit: 30 });
      console.log(matches[0].emoji); // 👍🏽
    } catch (error) {
      console.error('Could not load emojis:', error);
    }
  }
  startEmojiSearch();
</script>
```

Replace both example URLs with your uploaded files' locations. The JSON URL must serve the JSON itself, not a download or login page. If it is on a different origin from the consuming page, its host must permit that page to fetch it through CORS. Loading the JavaScript through a script tag does not grant access to a separate JSON URL. Serve the JavaScript with a JavaScript content type and the JSON as `application/json`. This library targets modern browsers with native `fetch`, Unicode property escapes, and `AbortSignal.timeout`.

`browser/demo.html` provides a complete plain HTML search example. It expects `emoji.js` beside it and `emojis.json` one directory above it; adjust those paths after uploading. Serve the demo over HTTP/HTTPS rather than opening it as a local `file:` URL. It renders names and glyphs with DOM text properties.

### Browser API

- `await Emoji.init(url)`: download and validate the dataset, then prepare search records and skin-tone lookups. Fetching times out after 30 seconds. Calls using the same resolved URL share the same Promise and do not redownload; failed loads can be retried. Once loading starts or completes successfully, changing the dataset URL requires a page reload. Relative URLs resolve against the page, not the script file.
- `Emoji.search(query, skinTone = null, options = {})`: synchronous local search after initialization. Returns an array of results; no matches returns `[]`. Searching before readiness throws. No search request accesses the network.
- `options.limit`: a nonnegative integer, default `50`; `0` returns no results.
- `options.category`: optional exact category name, for example `"People & Body"`.
- `skinTone`: `null` for default, or `light`, `medium-light`, `medium`, `medium-dark`, or `dark`. Unknown values throw. For multi-person emojis, all modifiers must match the chosen tone; unavailable tones fall back to the default. Existing mixed-tone variants remain accessible through each result's `variants` array.

Search uses case-insensitive, Unicode-normalized words from default names and keywords. Every query word must match a whole word or its prefix: `"thumb"` matches `"thumbs up"`, while `"thums"` does not. Exact full-name matches rank first, followed by the number of exact word matches, then source order. Empty or punctuation-only queries browse entries in source order. Search does not invent synonyms or correct typos. Tone metadata is selected after matching, so choose tones through the second argument rather than including them in the query.

Each result contains `emoji`, `name`, `keywords`, `emojiVersion`, `skinTones`, `baseEmoji`, `category`, `subgroup`, and `variants`. Display fields describe the selected variant, while `variants` lists all available tones for the default entry. Results are independent copies, including their nested arrays, so modifying them cannot change subsequent searches. Each default produces one result; unmatched toned entries in partial datasets remain searchable.

```js
Emoji.search('grin fa');
Emoji.search('', null, { category: 'People & Body', limit: 100 });
Emoji.search('people holding hands', 'medium');
```

Normalization and tone lookup preparation happen once during initialization. Each search scans prepared records, ranks matches, and copies only the limited result set. Keep the returned data in your own rendering code; the library creates no UI and stores no preferences. Tests cover the browser API in an isolated browser-like global and run the demo's actual script against a minimal DOM harness; they do not replace a visual check in your target browser.

## Generated dataset

Generation fetches the latest emoji dataset and both CLDR annotation files concurrently, then writes compact UTF-8 `emojis.json` in the project directory, with no indentation or trailing newline. The reported Unicode emoji version is included in the output. Each download times out after 30 seconds; download, parsing, or annotation-validation failures exit with an error and leave existing output intact. Successful runs replace the output using a temporary file. The examples below are abbreviated and formatted only for readability.

Keywords come from Unicode's English [CLDR annotations](https://github.com/unicode-org/cldr-json/tree/main/cldr-json/cldr-annotations-full/annotations/en) and [derived annotations](https://github.com/unicode-org/cldr-json/tree/main/cldr-json/cldr-annotations-derived-full/annotationsDerived/en), fetched from the `main` branch. The generator merges name-derived words with words from CLDR search annotations (`default`) and short names (`tts`), normalizes with NFKC, lowercases, splits punctuation/whitespace, and deduplicates in stable order. Display names remain those in `emoji-test.txt`.

Matching ignores the emoji presentation selector U+FE0F but preserves skin-tone modifiers and joiners. Variants receive their own annotations and inherit the enriched base keywords; variant-specific words are not added to the base. An emoji without annotations retains its name-derived keywords. CLDR and emoji releases may differ, so not every new emoji will have annotations immediately. There is no custom dictionary or extra runtime dependency.

Run `npm run generate` and upload the regenerated `emojis.json` to replace the old file. The existing browser library automatically searches the richer keywords; it needs no update or additional requests. Reload pages that have already initialized to load the new data, and refresh any hosting cache if necessary. Additional keywords increase the JSON size; output remains compact.

```json
{
  "version": "17.0",
  "categories": [
    {
      "name": "Smileys & Emotion",
      "subgroups": [
        {
          "name": "face-smiling",
          "emojis": [
            {
              "emoji": "😀",
              "name": "grinning face",
              "keywords": ["grinning", "face"],
              "emojiVersion": "1.0",
              "skinTones": [],
              "baseEmoji": "😀",
              "variants": []
            }
          ]
        }
      ]
    }
  ]
}
```

Categories and subgroups follow the source order. Only fully qualified entries are included, including skin-tone and multi-code-point sequences. Alternative presentation forms, standalone components, and empty groups are omitted. Names are preserved from Unicode; generated keywords combine name-derived words and CLDR annotations as described above.

Each subgroup's `emojis` array contains default entries with their skin-tone variants nested under `variants`. Variants are stored once, not repeated in the subgroup list. Defaults and variants preserve source order within their respective arrays. This changes the earlier flat layout: scripts that need every sequence must flatten `[entry, ...entry.variants]`.

Each entry includes:

- `emojiVersion`: the source's `E` version without the prefix, such as `"0.6"` or `"14.0"`. This is the version that introduced that specific sequence; a variant may be newer than its base. Values remain strings to preserve version notation. Compare numeric version components, not decimal numbers or strings, when filtering.
- `skinTones`: ordered modifier values (`light`, `medium-light`, `medium`, `medium-dark`, `dark`). An empty array means no explicit tone. Multiple modifiers are preserved, including repeated tones.
- `baseEmoji`: the fully qualified default emoji shared by its tone variants, for example `👍🏽` → `👍`. Unmodified entries reference themselves. If no matching base exists in the input, this is `null`.
- `variants`: an array on each subgroup-level entry, empty when no variants are available. Nested variants retain `emoji`, `name`, `keywords`, `emojiVersion`, `skinTones`, and `baseEmoji`, without a recursive `variants` field. Unmatched toned entries remain at subgroup level with `baseEmoji: null` and `variants: []`, so partial or future input cannot silently lose entries.

For example, a default entry with one variant looks like this (the full dataset contains more tones):

```json
{
  "emoji": "👍",
  "name": "thumbs up",
  "keywords": ["thumbs", "up"],
  "emojiVersion": "0.6",
  "skinTones": [],
  "baseEmoji": "👍",
  "variants": [
    {
      "emoji": "👍🏽",
      "name": "thumbs up: medium skin tone",
      "keywords": ["thumbs", "up", "medium", "skin", "tone"],
      "emojiVersion": "1.0",
      "skinTones": ["medium"],
      "baseEmoji": "👍"
    }
  ]
}
```

Bases are resolved from unmodified sequences (ignoring presentation selectors for lookup), with a name-based fallback for differently encoded variants such as mixed-tone handshakes. Only existing entries are referenced; no emoji sequences are synthesized. Modifier values follow [Unicode's emoji modifiers](https://www.unicode.org/reports/tr51/#Emoji_Modifiers).

A future picker can keep the default entries visible and choose an existing variant for a saved preference:

```js
const emojis = data.categories.flatMap(category =>
  category.subgroups.flatMap(subgroup => subgroup.emojis));
// Build once after loading the JSON, then reuse for picker lookups.
const byEmoji = new Map(emojis.map(entry => [entry.emoji, entry]));

function withSkinTone(baseEmoji, selectedTone) {
  const base = byEmoji.get(baseEmoji);
  if (!base || !selectedTone) return base;
  return base.variants.find(entry =>
    entry.skinTones.every(tone => tone === selectedTone)
  ) ?? base;
}

// withSkinTone('👍', 'medium').emoji === '👍🏽'
```

Use `skinTones.length === 0` to identify default entries and `variants.length > 0` to check for available tones. Mixed-tone entries remain available for a future per-person selector. Unsupported preferences fall back to the default. Search the default entries' names and keywords for a picker, then apply the user's tone preference when displaying or inserting the selected emoji.

The parser can also be used independently without network or file access:

```js
const { parseEmojiTest } = require('./index');
const data = parseEmojiTest(text);
```

`parseEmojiTest(text)` still produces name-derived keywords without network access. The generator applies the separate `enrichKeywords(data, annotations, derived)` function from `keywords.js` afterward. This function validates both English CLDR documents, enriches the parsed dataset in place, and returns it.

The latest URL may change over time; the output records the source's version rather than pinning a release. The example above is illustrative.

Unicode emoji and CLDR data are © Unicode, Inc. and subject to [Unicode's terms of use](https://www.unicode.org/terms_of_use.html) and [Unicode data license](https://www.unicode.org/license.txt). Preserve applicable Unicode attribution when redistributing the generated dataset. The package's ISC license does not replace the upstream data license.
