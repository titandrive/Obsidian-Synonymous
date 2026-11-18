import {
	App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView,
	Menu, Platform, Plugin, PluginSettingTab, Setting,
} from "obsidian";
import { define, matchCase, synonyms } from "./src/sources";
import { closeFloating, showDefinition, showSynonyms } from "./src/ui";

/*
 * Word Lookup: synonyms and definitions for the word you're writing.
 *   Synonyms: select a word (a double-click does it), run "Show synonyms" (give it a hotkey), or type
 *   the word followed by the trigger character, e.g. "happy^". Pick one to replace the word.
 *   Definitions: Ctrl/Cmd-click a word, right-click it, or run "Look up word".
 */

interface Settings {
	synonymsOnSelect: boolean;
	triggerChar: string;
	lookupOnModClick: boolean;
	maxSynonyms: number;
}

const DEFAULTS: Settings = {
	synonymsOnSelect: true,
	triggerChar: "^",
	lookupOnModClick: true,
	maxSynonyms: 20,
};

/** A word: letters, with apostrophes or hyphens inside it ("don't", "well-known"). */
const WORD = /^[\p{L}][\p{L}'’-]*$/u;
/** A selection that counts as a word or short phrase to find synonyms for (up to three words). */
const isLookupText = (text: string) => {
	const t = text.trim();
	return t.length > 0 && t.length <= 40 && t.split(/\s+/).length <= 3 && t.split(/\s+/).every((w) => WORD.test(w));
};

export default class WordLookup extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private selectTimer = 0;
	/** Where the last right-click was, so the menu acts on the word under the mouse. */
	private menuAt: { x: number; y: number } | null = null;

	async onload(): Promise<void> {
		this.settings = { ...DEFAULTS, ...(await this.loadData()) };
		this.addSettingTab(new WordLookupSettings(this.app, this));
		this.registerEditorSuggest(new TriggerSuggest(this));

		this.addCommand({
			id: "show-synonyms",
			name: "Show synonyms",
			editorCallback: (editor) => {
				const target = this.targetWord(editor);
				if (target) this.openSynonyms(editor, target.from, target.to, target.text);
			},
		});
		this.addCommand({
			id: "look-up-word",
			name: "Look up word",
			editorCallback: (editor) => {
				const target = this.targetWord(editor);
				if (target) this.openDefinition(editor, target.from, target.text);
			},
		});

		// Right-click a word: look it up, or see synonyms. The word under the mouse, or the selection
		// when you right-click inside it.
		this.registerDomEvent(document, "contextmenu", (e: MouseEvent) => { this.menuAt = { x: e.clientX, y: e.clientY }; }, { capture: true });
		this.registerEvent(this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
			const target = this.wordAtMouse(editor) ?? this.targetWord(editor);
			if (!target) return;
			menu.addItem((i) => i.setSection("word-lookup").setTitle(`Look up "${target.text}"`).setIcon("book-open")
				.onClick(() => this.openDefinition(editor, target.from, target.text)));
			menu.addItem((i) => i.setSection("word-lookup").setTitle(`Synonyms for "${target.text}"`).setIcon("replace")
				.onClick(() => this.openSynonyms(editor, target.from, target.to, target.text)));
		}));

		// Ctrl/Cmd-click a word to look it up. Handled on mousedown so the editor doesn't add a second
		// cursor (its own Ctrl/Cmd-click). Links keep their own Ctrl/Cmd-click.
		this.registerDomEvent(document, "mousedown", (e: MouseEvent) => {
			if (!this.settings.lookupOnModClick || e.button !== 0 || !(Platform.isMacOS ? e.metaKey : e.ctrlKey)) return;
			const target = e.target as HTMLElement;
			if (!target.closest(".markdown-source-view .cm-content") || target.closest("a, .cm-link, .cm-url, .cm-hmd-internal-link")) return;
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			const cm = (editor as unknown as { cm?: { posAtCoords(c: { x: number; y: number }): number | null } })?.cm;
			const offset = cm?.posAtCoords({ x: e.clientX, y: e.clientY });
			if (!editor || offset == null) return;
			const range = editor.wordAt(editor.offsetToPos(offset));
			if (!range) return;
			const text = editor.getRange(range.from, range.to);
			if (!WORD.test(text)) return;
			e.preventDefault();
			e.stopPropagation();
			this.openDefinition(editor, range.from, text);
		}, { capture: true });

		// Selecting a word (or a short phrase) shows its synonyms, once the mouse is released.
		this.registerDomEvent(document, "mouseup", (e: MouseEvent) => {
			if (!this.settings.synonymsOnSelect || e.button !== 0 || e.ctrlKey || e.metaKey) return;
			if (!(e.target as HTMLElement).closest(".markdown-source-view .cm-content")) return;
			window.clearTimeout(this.selectTimer);
			this.selectTimer = window.setTimeout(() => {
				const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
				if (!editor || !editor.somethingSelected()) return;
				const text = editor.getSelection();
				if (!isLookupText(text)) return;
				const from = editor.getCursor("from"), to = editor.getCursor("to");
				this.openSynonyms(editor, from, to, text.trim());
			}, 200);
		});
	}

	onunload(): void {
		window.clearTimeout(this.selectTimer);
		closeFloating();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The word at the last right-click, or the selection if the click was inside it. */
	private wordAtMouse(editor: Editor): { from: EditorPosition; to: EditorPosition; text: string } | null {
		const at = this.menuAt;
		this.menuAt = null;
		const cm = (editor as unknown as { cm?: { posAtCoords(c: { x: number; y: number }): number | null } }).cm;
		const offset = at && cm ? cm.posAtCoords(at) : null;
		if (offset == null) return null;
		if (editor.somethingSelected()) {
			const from = editor.posToOffset(editor.getCursor("from")), to = editor.posToOffset(editor.getCursor("to"));
			if (offset >= from && offset <= to) return this.targetWord(editor);
		}
		const range = editor.wordAt(editor.offsetToPos(offset));
		if (!range) return null;
		const text = editor.getRange(range.from, range.to);
		return WORD.test(text) ? { from: range.from, to: range.to, text } : null;
	}

	/** The selection if it's a word or short phrase, otherwise the word at the cursor. */
	private targetWord(editor: Editor): { from: EditorPosition; to: EditorPosition; text: string } | null {
		if (editor.somethingSelected()) {
			const text = editor.getSelection();
			if (!isLookupText(text)) return null;
			return { from: editor.getCursor("from"), to: editor.getCursor("to"), text: text.trim() };
		}
		const range = editor.wordAt(editor.getCursor());
		if (!range) return null;
		const text = editor.getRange(range.from, range.to);
		return WORD.test(text) ? { from: range.from, to: range.to, text } : null;
	}

	openSynonyms(editor: Editor, from: EditorPosition, to: EditorPosition, word: string): void {
		const original = editor.getRange(from, to);
		showSynonyms(editor, from, word, synonyms(word, this.settings.maxSynonyms), (s) => {
			// Only replace if the text is still what was looked up.
			if (editor.getRange(from, to) !== original) return;
			const replacement = matchCase(word, s);
			editor.replaceRange(replacement, from, to);
			editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + replacement.length));
		});
	}

	openDefinition(editor: Editor, at: EditorPosition, word: string): void {
		showDefinition(editor, at, word, define(word));
	}
}

/** Typing a word and then the trigger character ("happy^") opens its synonyms in Obsidian's suggestion list. */
class TriggerSuggest extends EditorSuggest<string> {
	constructor(private plugin: WordLookup) {
		super(plugin.app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const trigger = this.plugin.settings.triggerChar;
		if (!trigger) return null;
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		if (!before.endsWith(trigger)) return null;
		const match = before.slice(0, -trigger.length).match(/([\p{L}][\p{L}'’-]*)$/u);
		if (!match) return null;
		return { start: { line: cursor.line, ch: cursor.ch - trigger.length - match[1].length }, end: cursor, query: match[1] };
	}

	async getSuggestions(context: EditorSuggestContext): Promise<string[]> {
		return synonyms(context.query, this.plugin.settings.maxSynonyms);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		const ctx = this.context;
		if (!ctx) return;
		ctx.editor.replaceRange(matchCase(ctx.query, value), ctx.start, ctx.end);
	}
}

class WordLookupSettings extends PluginSettingTab {
	constructor(app: App, private plugin: WordLookup) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Synonyms").setHeading();
		new Setting(containerEl)
			.setName("Show synonyms when you select a word")
			.setDesc("Selecting a word or short phrase (a double-click selects a word) opens its synonyms. Pick one to replace it.")
			.addToggle((t) => t.setValue(s.synonymsOnSelect).onChange(async (v) => { s.synonymsOnSelect = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl)
			.setName("Trigger character")
			.setDesc("Type a word followed by this to see its synonyms, e.g. happy^. Leave empty to turn it off.")
			.addText((t) => t.setPlaceholder("^").setValue(s.triggerChar).onChange(async (v) => { s.triggerChar = v.trim(); await this.plugin.saveSettings(); }));
		new Setting(containerEl)
			.setName("Most synonyms to show")
			.addSlider((sl) => sl.setLimits(5, 50, 5).setValue(s.maxSynonyms).setDynamicTooltip()
				.onChange(async (v) => { s.maxSynonyms = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setDesc("There's also a \"Show synonyms\" command: give it a hotkey in Settings → Hotkeys.");

		new Setting(containerEl).setName("Definitions").setHeading();
		new Setting(containerEl)
			.setName(`Look up a word with ${Platform.isMacOS ? "Cmd" : "Ctrl"}-click`)
			.setDesc("Definitions also open from the right-click menu and the \"Look up word\" command.")
			.addToggle((t) => t.setValue(s.lookupOnModClick).onChange(async (v) => { s.lookupOnModClick = v; await this.plugin.saveSettings(); }));
	}
}
