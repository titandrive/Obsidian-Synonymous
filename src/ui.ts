import { Editor, EditorPosition } from "obsidian";
import { Definition, splitHint, SynonymGroup } from "./sources";

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
	const el = doc.body.createDiv({ cls: `synonymous-floating ${cls}` });
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
 * The synonym dropdown under a word: a "loading" line first, then the synonyms, redrawn as each
 * source arrives (top source first). ↑↓ and Enter (or a click) pick one; `pick` does the replacing.
 * `load` calls `update` with the list so far and resolves when every source has answered.
 */
export function showSynonyms(
	editor: Editor, pos: EditorPosition, word: string,
	load: (update: (groups: SynonymGroup[]) => void) => Promise<SynonymGroup[]>, pick: (synonym: string) => void,
): void {
	let items: string[] = [];
	let active = 0;
	const el = open(editor, pos, "synonymous-synonyms suggestion-container", (e) => {
		if (!items.length) return false;
		if (e.key === "ArrowDown") { active = (active + 1) % items.length; paint(); return true; }
		if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; paint(); return true; }
		if (e.key === "Enter" || e.key === "Tab") { choose(items[active]); return true; }
		return false;
	});
	if (!el) return;
	const list = el.createDiv({ cls: "suggestion" });
	list.createDiv({ cls: "synonymous-note", text: `Synonyms for "${word}"…` });
	const choose = (s: string) => { closeFloating(); pick(s); };
	const paint = (scroll = true) => {
		list.querySelectorAll(".suggestion-item").forEach((r, i) => r.toggleClass("is-selected", i === active));
		if (scroll) list.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
	};
	const render = (groups: SynonymGroup[], done: boolean) => {
		if (!el.isConnected) return;
		const next = groups.flatMap((g) => g.words);
		if (!next.length && !done) return; // keep "Synonyms for…" until something arrives
		const scrollTop = list.scrollTop;
		items = next;
		active = Math.min(active, Math.max(0, items.length - 1));
		list.empty();
		if (!items.length) {
			list.createDiv({ cls: "synonymous-note", text: `No synonyms found for "${word}".` });
			return;
		}
		// Each source's part of the list starts with its name (a divider above it after the first), then
		// a heading per meaning when the source groups them, then the words.
		let i = 0;
		let lastSource: string | undefined;
		for (const g of groups) {
			if (g.source && g.source !== lastSource) {
				if (lastSource !== undefined) list.createDiv({ cls: "synonymous-divider" });
				list.createDiv({ cls: "synonymous-source-label", text: g.source });
				lastSource = g.source;
			}
			if (g.heading) list.createDiv({ cls: "synonymous-heading", text: g.heading });
			for (const s of g.words) {
				const index = i++;
				// A hint in parentheses ("act (toward)") is shown faintly; only the word is inserted.
				const { word: w, hint } = splitHint(s);
				const row = list.createDiv({ cls: "suggestion-item", text: w });
				if (hint) row.createSpan({ cls: "synonymous-hint", text: ` ${hint}` });
				// mousedown, so the editor keeps its selection until the word is replaced.
				row.addEventListener("mousedown", (e) => { e.preventDefault(); choose(s); });
				row.addEventListener("mousemove", () => { if (active !== index) { active = index; paint(false); } });
			}
		}
		list.scrollTop = scrollTop; // later sources are added below; don't jump
		paint(false);
		place(el, anchorFor(editor, pos) ?? { left: 8, top: 8, bottom: 8 });
	};
	void load((groups) => render(groups, false)).then((groups) => render(groups, true));
}

/**
 * The definition popover under a word. Every source that knows the word gets a page, the top source
 * first, paged with ‹ 1/2 › in the corner (like the reading card). The first page shows as soon as
 * its source answers; the others are added as they arrive. The popup keeps the size of its tallest
 * page, so it doesn't jump while paging.
 */
export function showDefinition(
	editor: Editor, pos: EditorPosition, word: string,
	load: (update: (defs: Definition[]) => void) => Promise<Definition[]>,
): void {
	const el = open(editor, pos, "synonymous-definition");
	if (!el) return;
	const head = el.createDiv({ cls: "synonymous-head" });
	const title = head.createDiv({ cls: "synonymous-word", text: word });
	const pager = head.createDiv({ cls: "synonymous-pager" });
	const body = el.createDiv({ cls: "synonymous-body" });
	const foot = el.createDiv({ cls: "synonymous-foot" });
	body.createDiv({ cls: "synonymous-note", text: "Looking it up…" });

	let defs: Definition[] = [];
	let page = 0;
	const count = createSpan({ cls: "synonymous-pager-count" });
	const fill = (i: number) => {
		const def = defs[i];
		title.setText(def.word);
		if (def.phonetic) title.createSpan({ cls: "synonymous-phonetic", text: def.phonetic });
		body.empty();
		for (const m of def.meanings.slice(0, 4)) {
			if (m.partOfSpeech) body.createDiv({ cls: "synonymous-pos", text: m.partOfSpeech });
			const ol = body.createEl("ol");
			for (const d of m.definitions.slice(0, 3)) {
				const li = ol.createEl("li", { text: d.text });
				if (d.example) li.createDiv({ cls: "synonymous-example", text: d.example });
			}
		}
		body.scrollTop = 0;
		foot.empty();
		foot.createSpan({ text: def.source });
		const site = def.source === "Merriam-Webster" ? "Merriam-Webster" : "Wiktionary";
		const more = foot.createEl("a", { text: `More on ${site}`, href: def.url });
		more.addEventListener("click", (e) => { e.preventDefault(); window.open(def.url, "_blank"); });
	};
	const show = (i: number) => {
		page = (i + defs.length) % defs.length;
		fill(page);
		count.setText(`${page + 1}/${defs.length}`);
	};
	const button = (label: string, aria: string, by: number) => {
		const b = pager.createEl("button", { text: label, attr: { "aria-label": aria } });
		b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's focus
		b.onclick = () => show(page + by);
	};
	const render = (next: Definition[], done: boolean) => {
		if (!el.isConnected) return;
		if (!next.length) {
			if (done) { body.empty(); body.createDiv({ cls: "synonymous-note", text: `No definition found for "${word}".` }); }
			return;
		}
		const first = !defs.length;
		defs = next;
		if (defs.length > 1 && !pager.childElementCount) {
			button("‹", "Previous source", -1);
			pager.append(count);
			button("›", "Next source", 1);
		}
		if (defs.length > 1) {
			// Same height on every page: measure each, then hold the tallest, and return to the page shown.
			const keep = page;
			body.style.minHeight = "";
			let tallest = 0;
			defs.forEach((_, i) => { fill(i); tallest = Math.max(tallest, body.offsetHeight); });
			body.style.minHeight = `${tallest}px`;
			show(keep);
		} else {
			show(0);
		}
		if (first || done) place(el, anchorFor(editor, pos) ?? { left: 8, top: 8, bottom: 8 });
	};
	void load((d) => render(d, false)).then((d) => render(d, true));
}
