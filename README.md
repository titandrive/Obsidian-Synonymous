# Word Lookup

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

- Synonyms: [Datamuse](https://www.datamuse.com/api/), ordered by how close in meaning they are.
- Definitions: the [Free Dictionary API](https://dictionaryapi.dev/), falling back to [Wiktionary](https://en.wiktionary.org/) for words it doesn't know.

Both are free and need no account or key. Lookups are kept for the session, so the same word is instant the second time. English only.

## Settings

- Show synonyms when you select a word (on by default)
- Trigger character (`^` by default; empty turns it off)
- Most synonyms to show (20 by default)
- Look up a word with Ctrl/Cmd-click (on by default)
