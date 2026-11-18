import { Editor, EditorPosition } from "obsidian";
import { Definition } from "./sources";

/*
 * The floating synonym dropdown and the definition popover, both placed under a word in the editor.
 * Only one is open at a time; Escape, a click elsewhere, or scrolling closes it.
 */

let current: { el: HTMLElement; close: () => void } | null = null;

export function closeFloating(): void {
	current?.close();
}

/** Screen position just under a spot in the editor (null if it isn't on screen). */
function anchorFor(editor: Editor, pos: EditorPosition): { left: number; top: number; bottom: number } | null {
	const view = (editor as unknown as { cm?: { coordsAtPos(offset: number): { left: number; top: number; bottom: number } | null } }).cm;
	return view?.coordsAtPos(editor.posToOffset(pos)) ?? null;
}

/** Put a floating element under (or, without room, above) the anchor, kept inside the window. */
function place(el: HTMLElement, at: { left: number; top: number; bottom: number }): void {
	const win = el.win;
	const w = el.offsetWidth, h = el.offsetHeight;
	el.style.left = `${Math.max(8, Math.min(at.left, win.innerWidth - w - 8))}px`;
	const below = at.bottom + 6;
	el.style.top = `${below + h <= win.innerHeight - 8 ? below : Math.max(8, at.top - 6 - h)}px`;
}

function open(editor: Editor, pos: EditorPosition, cls: string, onKey?: (e: KeyboardEvent) => boolean): HTMLElement | null {
	closeFloating();
	const at = anchorFor(editor, pos);
	if (!at) return null;
	const doc = activeDocument;
	const el = doc.body.createDiv({ cls: `word-lookup-floating ${cls}` });
	const onDown = (e: MouseEvent) => { if (!el.contains(e.target as Node)) close(); };
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
		if (onKey?.(e)) { e.preventDefault(); e.stopPropagation(); }
	};
	const onScroll = (e: Event) => { if (!el.contains(e.target as Node)) close(); };
	const close = () => {
		el.remove();
		doc.removeEventListener("mousedown", onDown, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("scroll", onScroll, true);
		if (current?.el === el) current = null;
	};
	// Added on the next tick so the click that opened it doesn't close it straight away.
	window.setTimeout(() => doc.addEventListener("mousedown", onDown, true));
	doc.addEventListener("keydown", onKeyDown, true);
	doc.addEventListener("scroll", onScroll, true);
	current = { el, close };
	window.requestAnimationFrame(() => place(el, at));
	place(el, at);
	return el;
}

/**
 * The synonym dropdown under a word: a "loading" line first, then the synonyms. ↑↓ and Enter (or a
 * click) pick one; `pick` does the replacing.
 */
export function showSynonyms(editor: Editor, pos: EditorPosition, word: string, load: Promise<string[]>, pick: (synonym: string) => void): void {
	let items: string[] = [];
	let active = 0;
	const el = open(editor, pos, "word-lookup-synonyms suggestion-container", (e) => {
		if (!items.length) return false;
		if (e.key === "ArrowDown") { active = (active + 1) % items.length; paint(); return true; }
		if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; paint(); return true; }
		if (e.key === "Enter" || e.key === "Tab") { choose(items[active]); return true; }
		return false;
	});
	if (!el) return;
	const list = el.createDiv({ cls: "suggestion" });
	list.createDiv({ cls: "word-lookup-note", text: `Synonyms for "${word}"…` });
	const choose = (s: string) => { closeFloating(); pick(s); };
	const paint = () => {
		list.querySelectorAll(".suggestion-item").forEach((r, i) => r.toggleClass("is-selected", i === active));
		list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
	};
	void load.then((found) => {
		if (!el.isConnected) return;
		items = found;
		list.empty();
		if (!found.length) {
			list.createDiv({ cls: "word-lookup-note", text: `No synonyms found for "${word}".` });
			return;
		}
		found.forEach((s, i) => {
			const row = list.createDiv({ cls: "suggestion-item", text: s });
			// mousedown, so the editor keeps its selection until the word is replaced.
			row.addEventListener("mousedown", (e) => { e.preventDefault(); choose(s); });
			row.addEventListener("mousemove", () => { if (active !== i) { active = i; paint(); } });
		});
		paint();
	});
}

/** The definition popover under a word. */
export function showDefinition(editor: Editor, pos: EditorPosition, word: string, load: Promise<Definition | null>): void {
	const el = open(editor, pos, "word-lookup-definition");
	if (!el) return;
	el.createDiv({ cls: "word-lookup-word", text: word });
	const body = el.createDiv({ cls: "word-lookup-body" });
	body.createDiv({ cls: "word-lookup-note", text: "Looking it up…" });
	void load.then((def) => {
		if (!el.isConnected) return;
		body.empty();
		if (!def) {
			body.createDiv({ cls: "word-lookup-note", text: `No definition found for "${word}".` });
			return;
		}
		el.querySelector(".word-lookup-word")?.setText(def.word);
		if (def.phonetic) el.querySelector(".word-lookup-word")?.createSpan({ cls: "word-lookup-phonetic", text: def.phonetic });
		for (const m of def.meanings.slice(0, 4)) {
			if (m.partOfSpeech) body.createDiv({ cls: "word-lookup-pos", text: m.partOfSpeech });
			const ol = body.createEl("ol");
			for (const d of m.definitions.slice(0, 3)) {
				const li = ol.createEl("li", { text: d.text });
				if (d.example) li.createDiv({ cls: "word-lookup-example", text: d.example });
			}
		}
		const foot = el.createDiv({ cls: "word-lookup-foot" });
		foot.createSpan({ text: def.source });
		const more = foot.createEl("a", { text: "More on Wiktionary", href: def.url });
		more.addEventListener("click", (e) => { e.preventDefault(); window.open(def.url, "_blank"); });
		place(el, anchorFor(editor, pos) ?? { left: 8, top: 8, bottom: 8 });
	});
}
