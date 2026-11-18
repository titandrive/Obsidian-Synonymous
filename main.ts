import {
	App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, MarkdownView,
	Menu, Modal, Platform, Plugin, PluginSettingTab, Setting,
} from "obsidian";
import {
	defineAll, DEFINITION_SOURCES, DefinitionSourceId, KEY_INFO, Keys, LookupStore, matchCase, splitHint, SYNONYM_SOURCES, SynonymGroup, SynonymSourceId, synonyms, testKey, useStore, warmUp,
} from "./src/sources";
import { closeFloating, showDefinition, showSynonyms } from "./src/ui";

/*
 * Synonymous: synonyms and definitions for the word you're writing.
 *   Synonyms: select a word (a double-click does it), run "Show synonyms" (give it a hotkey), or type
 *   the word followed by the trigger character, e.g. "happy^". Pick one to replace the word.
 *   Definitions: Ctrl/Cmd-click a word, right-click it, or run "Look up word".
 */

/** A source in a ranked list: its place is its rank, and it can be turned off. */
interface SourcePick<Id> { id: Id; on: boolean }

interface Settings {
	synonymsOnSelect: boolean;
	triggerChar: string;
	/** How "word^" shows its synonyms: Obsidian's suggestion list, or the same dropdown as selecting a word. */
	triggerStyle: "suggest" | "dropdown";
	lookupOnModClick: boolean;
	maxSynonyms: number;
	keys: Keys;
	synonymSources: Array<SourcePick<SynonymSourceId>>;
	definitionSources: Array<SourcePick<DefinitionSourceId>>;
	/** Use the sources below the top one only when the ones above have nothing for the word. */
	synonymBackupOnly: boolean;
	definitionBackupOnly: boolean;
}

const DEFAULTS: Settings = {
	synonymsOnSelect: true,
	triggerChar: "^",
	triggerStyle: "suggest",
	lookupOnModClick: true,
	maxSynonyms: 20,
	keys: { mwThesaurus: "", mwDictionary: "", bigHuge: "" },
	// Sources that need a key are listed first: they're the best, and only used once a key is entered.
	synonymSources: [
		{ id: "merriam-webster", on: true }, { id: "big-huge", on: true },
		{ id: "free-dictionary", on: true }, { id: "datamuse", on: true },
	],
	definitionSources: [
		{ id: "merriam-webster", on: true }, { id: "free-dictionary", on: true }, { id: "wiktionary", on: true },
	],
	synonymBackupOnly: false,
	definitionBackupOnly: false,
};

/** A saved ranked list, with any source added since it was saved put at the end. */
function withAllSources<Id extends string>(saved: Array<SourcePick<Id>> | undefined, defaults: Array<SourcePick<Id>>): Array<SourcePick<Id>> {
	const list = (saved ?? []).filter((p) => defaults.some((d) => d.id === p.id));
	for (const d of defaults) if (!list.some((p) => p.id === d.id)) list.push({ ...d });
	return list;
}

/**
 * Lookups remembered between sessions, so a word looked up before is instant even after a restart.
 * Kept in this device's local storage (not synced), for 30 days, within a size limit: the oldest go first.
 */
class SavedLookups implements LookupStore {
	private static KEY = "synonymous-lookups";
	private static MAX_AGE = 30 * 24 * 60 * 60 * 1000;
	private static MAX_CHARS = 1_500_000;
	private data: Record<string, { t: number; v: unknown }> = {};
	private timer = 0;

	constructor(private app: App) {
		try {
			const raw = this.app.loadLocalStorage(SavedLookups.KEY);
			if (typeof raw === "string") this.data = JSON.parse(raw);
		} catch { this.data = {}; }
	}

	get(key: string): unknown | undefined {
		const e = this.data[key];
		if (!e) return undefined;
		if (Date.now() - e.t > SavedLookups.MAX_AGE) { delete this.data[key]; return undefined; }
		return e.v;
	}

	set(key: string, value: unknown): void {
		this.data[key] = { t: Date.now(), v: value };
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.save(), 2000);
	}

	save(): void {
		window.clearTimeout(this.timer);
		let json = JSON.stringify(this.data);
		if (json.length > SavedLookups.MAX_CHARS) {
			// Drop the oldest until it fits (with room to spare, so this doesn't run on every save).
			const entries = Object.entries(this.data).sort((a, b) => b[1].t - a[1].t);
			const kept: Record<string, { t: number; v: unknown }> = {};
			let size = 2;
			for (const [k, e] of entries) {
				const s = k.length + JSON.stringify(e).length + 4;
				if (size + s > SavedLookups.MAX_CHARS * 0.75) break;
				kept[k] = e;
				size += s;
			}
			this.data = kept;
			json = JSON.stringify(kept);
		}
		try { this.app.saveLocalStorage(SavedLookups.KEY, json); } catch { /* storage full: carry on without saving */ }
	}
}

/** A word: letters, with apostrophes or hyphens inside it ("don't", "well-known"). */
const WORD = /^[\p{L}][\p{L}'’-]*$/u;
/** A selection that counts as a word or short phrase to find synonyms for (up to three words). */
const isLookupText = (text: string) => {
	const t = text.trim();
	return t.length > 0 && t.length <= 40 && t.split(/\s+/).length <= 3 && t.split(/\s+/).every((w) => WORD.test(w));
};

export default class Synonymous extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private saved: SavedLookups | null = null;
	private selectTimer = 0;
	/** Where the last right-click was, so the menu acts on the word under the mouse. */
	private menuAt: { x: number; y: number } | null = null;

	async onload(): Promise<void> {
		const saved = (await this.loadData()) as Partial<Settings> | null;
		this.settings = {
			...DEFAULTS, ...saved,
			keys: { ...DEFAULTS.keys, ...saved?.keys },
			synonymSources: withAllSources(saved?.synonymSources, DEFAULTS.synonymSources),
			definitionSources: withAllSources(saved?.definitionSources, DEFAULTS.definitionSources),
		};
		this.addSettingTab(new SynonymousSettings(this.app, this));
		this.saved = new SavedLookups(this.app);
		useStore(this.saved);
		// Open connections to the sources shortly after startup, so the first lookup is quick.
		this.app.workspace.onLayoutReady(() => {
			this.registerInterval(window.setTimeout(() => warmUp(this.settings.keys, this.synonymOrder(), this.definitionOrder()), 2000));
		});
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
			menu.addItem((i) => i.setSection("synonymous").setTitle(`Look up "${target.text}"`).setIcon("book-open")
				.onClick(() => this.openDefinition(editor, target.from, target.text)));
			menu.addItem((i) => i.setSection("synonymous").setTitle(`Synonyms for "${target.text}"`).setIcon("replace")
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

		// "word^" with the dropdown style: the same dropdown as selecting a word, replacing "word^".
		this.registerEvent(this.app.workspace.on("editor-change", (editor: Editor) => {
			if (this.settings.triggerStyle !== "dropdown") return;
			const hit = triggerAt(editor, this.settings.triggerChar);
			if (hit) this.openSynonyms(editor, hit.start, hit.end, hit.word);
		}));

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
		this.saved?.save();
		useStore(null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Sources that are on and usable (key entered, if they need one), in their ranked order. */
	synonymOrder(): SynonymSourceId[] {
		return this.settings.synonymSources.filter((p) => p.on && this.hasKeyFor(SYNONYM_SOURCES[p.id].needsKey)).map((p) => p.id);
	}

	definitionOrder(): DefinitionSourceId[] {
		return this.settings.definitionSources.filter((p) => p.on && this.hasKeyFor(DEFINITION_SOURCES[p.id].needsKey)).map((p) => p.id);
	}

	hasKeyFor(key: keyof Keys | undefined): boolean {
		return !key || !!this.settings.keys[key].trim();
	}

	/** Synonyms for a word; `update` (optional) gets the list so far as each source arrives. */
	async findSynonyms(word: string, update?: (groups: SynonymGroup[]) => void): Promise<SynonymGroup[]> {
		const order = this.synonymOrder();
		// With only one source on (or showing, as backups only show when the top one has nothing), its
		// name says nothing: drop the source labels. The filler of related words keeps a plain "Related"
		// heading so it's still set apart.
		const labelled = order.length > 1 && !this.settings.synonymBackupOnly;
		const tidy = (groups: SynonymGroup[]) => labelled ? groups
			: groups.map((g) => g.source === "Related words" ? { words: g.words, heading: "Related" } : { heading: g.heading, words: g.words });
		const groups = await synonyms(word, order, this.settings.keys, this.settings.maxSynonyms, this.settings.synonymBackupOnly,
			update ? (g) => update(tidy(g)) : undefined);
		return tidy(groups);
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
		showSynonyms(editor, from, word, (update) => this.findSynonyms(word, update), (s) => {
			// Only replace if the text is still what was looked up.
			if (editor.getRange(from, to) !== original) return;
			const replacement = matchCase(word, splitHint(s).word);
			editor.replaceRange(replacement, from, to);
			editor.setCursor(editor.offsetToPos(editor.posToOffset(from) + replacement.length));
		});
	}

	openDefinition(editor: Editor, at: EditorPosition, word: string): void {
		showDefinition(editor, at, word, (update) => defineAll(word, this.definitionOrder(), this.settings.keys, this.settings.definitionBackupOnly, update));
	}
}

/**
 * The word just typed before the trigger character at the cursor ("happy^"), with the range to
 * replace (the word and the trigger), or null.
 */
function triggerAt(editor: Editor, trigger: string): { start: EditorPosition; end: EditorPosition; word: string } | null {
	if (!trigger || editor.somethingSelected()) return null;
	const cursor = editor.getCursor();
	const before = editor.getLine(cursor.line).slice(0, cursor.ch);
	if (!before.endsWith(trigger)) return null;
	const match = before.slice(0, -trigger.length).match(/([\p{L}][\p{L}'’-]*)$/u);
	if (!match) return null;
	return { start: { line: cursor.line, ch: cursor.ch - trigger.length - match[1].length }, end: cursor, word: match[1] };
}

/** Typing a word and then the trigger character ("happy^") opens its synonyms in Obsidian's suggestion list. */
class TriggerSuggest extends EditorSuggest<string> {
	constructor(private plugin: Synonymous) {
		super(plugin.app);
	}

	onTrigger(_cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		// With the dropdown style, the editor-change handler opens the dropdown instead.
		if (this.plugin.settings.triggerStyle !== "suggest") return null;
		const hit = triggerAt(editor, this.plugin.settings.triggerChar);
		return hit ? { start: hit.start, end: hit.end, query: hit.word } : null;
	}

	/** Just the synonyms, in order. */
	async getSuggestions(context: EditorSuggestContext): Promise<string[]> {
		const groups = await this.plugin.findSynonyms(context.query);
		return groups.flatMap((g) => g.words);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		const { word, hint } = splitHint(value);
		el.setText(word);
		if (hint) el.createSpan({ cls: "synonymous-hint", text: ` ${hint}` });
	}

	selectSuggestion(value: string): void {
		const ctx = this.context;
		if (!ctx) return;
		ctx.editor.replaceRange(matchCase(ctx.query, splitHint(value).word), ctx.start, ctx.end);
	}
}

class SynonymousSettings extends PluginSettingTab {
	constructor(app: App, private plugin: Synonymous) {
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
			.setName("Trigger character opens")
			.setDesc("Obsidian's suggestion list (like [[links]]), or the same dropdown as selecting a word, with source names and dividers.")
			.addDropdown((d) => d.addOption("suggest", "Suggestion list").addOption("dropdown", "Synonym dropdown")
				.setValue(s.triggerStyle).onChange(async (v) => { s.triggerStyle = v === "dropdown" ? "dropdown" : "suggest"; await this.plugin.saveSettings(); }));
		new Setting(containerEl)
			.setName("Most synonyms to show")
			.addSlider((sl) => sl.setLimits(5, 50, 5).setValue(s.maxSynonyms).setDynamicTooltip()
				.onChange(async (v) => { s.maxSynonyms = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setDesc("There's also a \"Show synonyms\" command: give it a hotkey in Settings → Hotkeys.");
		this.sourceList(containerEl, "Synonym sources", "Top source first; the ones below add words it doesn't have.", s.synonymSources, SYNONYM_SOURCES);
		new Setting(containerEl).setClass("synonymous-source")
			.setName("Use the other sources only as backup")
			.setDesc("Show the sources below the top one only when the ones above have no synonyms for the word.")
			.addToggle((t) => t.setValue(s.synonymBackupOnly).onChange(async (v) => { s.synonymBackupOnly = v; await this.plugin.saveSettings(); }));

		new Setting(containerEl).setName("Definitions").setHeading();
		new Setting(containerEl)
			.setName(`Look up a word with ${Platform.isMacOS ? "Cmd" : "Ctrl"}-click`)
			.setDesc("Definitions also open from the right-click menu and the \"Look up word\" command.")
			.addToggle((t) => t.setValue(s.lookupOnModClick).onChange(async (v) => { s.lookupOnModClick = v; await this.plugin.saveSettings(); }));
		this.sourceList(containerEl, "Definition sources", "Each source that knows the word gets a page in the popup (‹ 1/2 ›), top source first.", s.definitionSources, DEFINITION_SOURCES);
		new Setting(containerEl).setClass("synonymous-source")
			.setName("Use the other sources only as backup")
			.setDesc("Show only the top source that knows the word, instead of a page for each.")
			.addToggle((t) => t.setValue(s.definitionBackupOnly).onChange(async (v) => { s.definitionBackupOnly = v; await this.plugin.saveSettings(); }));
	}

	/**
	 * A ranked list of sources: each can be turned off and moved up or down; results come from the top
	 * source first. A source that needs a key is greyed out, with an "Add API key" button, until it has one.
	 */
	private sourceList<Id extends string>(containerEl: HTMLElement, title: string, desc: string, list: Array<SourcePick<Id>>, info: Record<Id, { name: string; needsKey?: keyof Keys }>): void {
		new Setting(containerEl).setName(title).setDesc(desc).setClass("synonymous-sources-title");
		list.forEach((pick, i) => {
			const field = info[pick.id].needsKey;
			const usable = this.plugin.hasKeyFor(field);
			const move = async (by: number) => {
				[list[i], list[i + by]] = [list[i + by], list[i]];
				await this.plugin.saveSettings();
				this.display();
			};
			const row = new Setting(containerEl).setName(`${i + 1}. ${info[pick.id].name}`).setClass("synonymous-source");
			if (field) {
				row.setDesc(usable ? "" : "Needs a free API key.");
				row.addButton((b) => b.setButtonText(usable ? "Edit API key" : "Add API key").onClick(() => {
					new KeyModal(this.app, field, this.plugin.settings.keys[field], async (value) => {
						this.plugin.settings.keys[field] = value;
						await this.plugin.saveSettings();
						this.display();
					}).open();
				}));
			}
			row.settingEl.toggleClass("is-disabled", !usable);
			row.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(() => void move(-1)))
				.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === list.length - 1).onClick(() => void move(1)))
				.addToggle((t) => t.setValue(pick.on && usable).setDisabled(!usable).onChange(async (v) => { pick.on = v; await this.plugin.saveSettings(); }));
		});
	}
}

/** Enter (or change) a key: paste it, test it with one lookup, and save. */
class KeyModal extends Modal {
	constructor(app: App, private field: keyof Keys, private value: string, private save: (value: string) => Promise<void>) {
		super(app);
	}

	onOpen(): void {
		const info = KEY_INFO[this.field];
		this.titleEl.setText(info.title);
		const { contentEl } = this;
		const intro = contentEl.createEl("p");
		intro.appendText(`Free. Get a ${info.product} key at `);
		intro.createEl("a", { text: new URL(info.signup).hostname, href: info.signup });
		intro.appendText(this.field === "bigHuge" ? "." : ". Merriam-Webster gives a separate key for the thesaurus and the dictionary.");

		const result = createDiv({ cls: "synonymous-key-result" });
		let input!: HTMLInputElement;
		new Setting(contentEl).setName("Key").addText((t) => {
			input = t.inputEl;
			t.setPlaceholder("Paste your key").setValue(this.value).onChange((v) => { this.value = v.trim(); result.empty(); });
		});
		contentEl.append(result);
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Test").onClick(async () => {
				result.empty();
				result.removeClass("is-ok", "is-error");
				result.setText("Testing…");
				const r = await testKey(this.field, this.value);
				result.setText(r.message);
				result.addClass(r.ok ? "is-ok" : "is-error");
			}))
			.addButton((b) => b.setButtonText("Save").setCta().onClick(async () => {
				await this.save(this.value);
				this.close();
			}));
		window.setTimeout(() => input?.focus());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
