# Synonymous

Synonyms and definitions for the word you're writing, without leaving the editor.

## Synonyms

Three ways to open a word's synonyms; pick one (↑↓ and Enter, or a click) to replace the word. The replacement keeps the word's capitalization (Happy → Glad).

- **Select it.** Selecting a word or a short phrase (a double-click selects a word) opens its synonyms under it.
- **Hotkey.** The **Show synonyms** command works on the selection or the word at the cursor. Give it a hotkey in Settings → Hotkeys.
- **Trigger character.** Type a word followed by `^`, e.g. `happy^`, and the synonyms appear in Obsidian's suggestion list. The character can be changed (or turned off) in settings.

## Definitions

- **Ctrl-click** (Cmd-click on macOS) a word.
- **Right-click** a word and choose **Look up**. The menu also has **Synonyms for**.
- The **Look up word** command.

The popup shows the pronunciation, each part of speech with its first definitions and examples, and a link to the word on Wiktionary.

## Sources

You choose which sources are used and in what order, separately for synonyms and for definitions (Settings → Synonymous). Synonyms come from every source that's on: the top one first, grouped by meaning when it can, and the others adding words it didn't have. For definitions, every source that's on is asked at once, and each one that knows the word gets a page in the popup: the top source first, with ‹ 1/3 › in the corner to page through the others.

| Source | Synonyms | Definitions | Key |
|---|---|---|---|
| Merriam-Webster | Grouped by meaning, curated | Yes | Free key |
| Big Huge Thesaurus | By part of speech | | Free key |
| [Free Dictionary](https://dictionaryapi.dev/) (Wiktionary) | Good for common words | Yes | None |
| [Datamuse](https://www.datamuse.com/api/) (WordNet) | Large but mixed | | None |
| [Wiktionary](https://en.wiktionary.org/) | | Huge coverage, slang too | None |

Every list is ordered by closeness of meaning and leaves out rare words ("quaternate", "riant"), using Datamuse's word data. Lookups are kept for the session, so the same word is instant the second time. English only.

Merriam-Webster and Big Huge Thesaurus are greyed out in the source lists until they have a key: click **Add API key** next to one, paste the key, press **Test** to check it works, then **Save**.

### Getting a Merriam-Webster key (free)

1. Register at [dictionaryapi.com](https://dictionaryapi.com/register/index). It's free for non-commercial use, 1,000 lookups a day per key.
2. On the form, request two keys: **Collegiate Thesaurus** (for synonyms) and **Collegiate Dictionary** (for definitions). You can request just one if you only want that part.
3. Confirm your email, then find the keys under **My Keys** on dictionaryapi.com.
4. In Settings → Synonymous, click **Add API key** next to Merriam-Webster under **Synonym sources** for the thesaurus key, and under **Definition sources** for the dictionary key. Press **Test**, then **Save**.

### Getting a Big Huge Thesaurus key (free)

1. Sign up at [words.bighugelabs.com](https://words.bighugelabs.com/site/api) and request an API key (the free plan allows 1,000 lookups a day).
2. In Settings → Synonymous, click **Add API key** next to Big Huge Thesaurus under **Synonym sources**, press **Test**, then **Save**.

## Settings

- Show synonyms when you select a word (on by default)
- Trigger character (`^` by default; empty turns it off)
- Most synonyms to show (20 by default)
- Look up a word with Ctrl/Cmd-click (on by default)
- Synonym sources and definition sources: on/off and order
- API keys for Merriam-Webster (thesaurus and dictionary) and Big Huge Thesaurus, added from the source lists
