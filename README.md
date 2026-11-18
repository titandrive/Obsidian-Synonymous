# Synonymous

Synonyms and definitions for the word you're writing, without leaving the editor.

## Synonyms

Three ways to open a word's synonyms; pick one (↑↓ and Enter, or a click) to replace the word. The replacement keeps the word's capitalization (Happy → Glad).

- **Select it.** Selecting a word or a short phrase (a double-click selects a word) opens its synonyms under it. On phones and tablets, long-press to select a word; the list opens once you let go, and the keyboard steps aside until you pick one. Each has its own on/off setting.
- **Hotkey.** The **Show synonyms** command works on the selection or the word at the cursor. Give it a hotkey in Settings → Hotkeys.
- **Trigger character.** Type a word followed by `^`, e.g. `happy^`, and its synonyms appear. By default they show in Obsidian's suggestion list (like `[[links]]`); a setting switches this to the same dropdown as selecting a word. The character can be changed (or turned off) in settings.

## Swapping them

**Settings → Selecting a word shows** can be switched to **Definitions**: then selecting a word (or long-pressing it on a phone) opens its definitions, and Ctrl-click (Cmd-click on macOS) opens its synonyms.

## Definitions

- **Ctrl-click** (Cmd-click on macOS) a word.
- **Right-click** a word and choose **Look up**. The menu also has **Synonyms for**.
- The **Look up word** command.

The popup shows the pronunciation, each part of speech with its first definitions and examples, and a link to the word on Wiktionary.

## Sources

You choose which sources are used and in what order, separately for synonyms and for definitions (Settings → Synonymous). Synonyms come from every source that's on: the top one first, grouped by meaning when it can, and the others adding words it didn't have. For definitions, every source that's on is asked at once, and each one that knows the word gets a page in the popup: the top source first, with ‹ 1/3 › in the corner to page through the others. Under each list, **Use the other sources only as backup** changes this: the lower sources are then used only when the ones above have nothing for the word.

| Source | Synonyms | Definitions | Key |
|---|---|---|---|
| Merriam-Webster | Grouped by meaning, curated | Yes | Free key |
| Big Huge Thesaurus | By part of speech | | Free key |
| [Free Dictionary](https://dictionaryapi.dev/) (Wiktionary) | Good for common words | Yes | None |
| [Datamuse](https://www.datamuse.com/api/) (WordNet) | Large but mixed | | None |
| [Wiktionary](https://en.wiktionary.org/) | | Huge coverage, slang too | None |

Every list is ordered by closeness of meaning and leaves out rare words ("quaternate", "riant"), using Datamuse's word data. Popups show your top source's answer as soon as it arrives and add the others as they come in. Lookups are remembered on each device (in Obsidian's local storage, not in your vault and not synced), so a word you've looked up before is instant, even after restarting Obsidian. Under **Saved lookups** in settings you can turn this off (which forgets them) or choose how long they're kept: 1, 7, 30 (default), 90 or 365 days. Offline, words you've looked up before still work from the saved lookups; for new ones the popup says it couldn't reach the dictionaries (a source that doesn't answer within 8 seconds is skipped), and the word is tried again next time. English only.

Merriam-Webster and Big Huge Thesaurus are greyed out in the source lists until they have a key: click **Add API key** next to one, paste the key, press **Test** to check it works, then **Save**. Once a source has a key, a cog next to it opens its settings: its key, and for Merriam-Webster's synonyms, **Show meanings** (the heading above each meaning's synonyms; off shows just the words).

### Getting a Merriam-Webster key (free)

1. Register at [dictionaryapi.com](https://dictionaryapi.com/register/index). It's free for non-commercial use, 1,000 lookups a day per key.
2. On the form, request two keys: **Collegiate Thesaurus** (for synonyms) and **Collegiate Dictionary** (for definitions). You can request just one if you only want that part.
3. Confirm your email, then find the keys under **My Keys** on dictionaryapi.com.
4. In Settings → Synonymous, click **Add API key** next to Merriam-Webster under **Synonym sources** for the thesaurus key, and under **Definition sources** for the dictionary key. Press **Test**, then **Save**.

### Getting a Big Huge Thesaurus key (free)

1. Sign up at [words.bighugelabs.com](https://words.bighugelabs.com/site/api) and request an API key (the free plan allows 1,000 lookups a day).
2. In Settings → Synonymous, click **Add API key** next to Big Huge Thesaurus under **Synonym sources**, press **Test**, then **Save**.

## Settings

- Show synonyms when you select a word (on by default), and separately when you long-press a word on mobile (on by default)
- Trigger character (`^` by default; empty turns it off), and whether it opens Obsidian's suggestion list or the synonym dropdown
- Most synonyms to show (20 by default)
- Look up a word with Ctrl/Cmd-click (on by default)
- Synonym sources and definition sources: on/off, order, and whether the lower ones are backups only
- Remember lookups (on by default) and how long to keep them (30 days by default)
- API keys for Merriam-Webster (thesaurus and dictionary) and Big Huge Thesaurus, added from the source lists
