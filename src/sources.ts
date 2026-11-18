import { requestUrl } from "obsidian";

/*
 * Where words come from. Synonyms: Datamuse (free, no key). Definitions: the Free Dictionary API
 * (free, no key), falling back to Wiktionary for words it doesn't know. Answers are kept for the
 * session, so looking up the same word again is instant.
 */

export interface Meaning {
	partOfSpeech: string;
	definitions: Array<{ text: string; example?: string }>;
}

export interface Definition {
	word: string;
	phonetic?: string;
	meanings: Meaning[];
	source: "Free Dictionary" | "Wiktionary";
	url: string;
}

const synonymCache = new Map<string, string[]>();
const definitionCache = new Map<string, Definition | null>();

async function getJson(url: string): Promise<unknown | null> {
	try {
		const res = await requestUrl({ url, throw: false });
		return res.status >= 200 && res.status < 300 ? res.json : null;
	} catch {
		return null;
	}
}

/**
 * Synonyms for a word or short phrase, closest first. Datamuse's synonyms come first, then words
 * with a similar meaning to fill out short lists. The word itself is never included.
 */
export async function synonyms(word: string, max: number): Promise<string[]> {
	const key = word.trim().toLowerCase();
	if (!key) return [];
	const cached = synonymCache.get(key);
	if (cached) return cached.slice(0, max);

	const q = encodeURIComponent(key);
	const [syn, like] = await Promise.all([
		getJson(`https://api.datamuse.com/words?rel_syn=${q}&max=50`),
		getJson(`https://api.datamuse.com/words?ml=${q}&max=50`),
	]);
	const words = (list: unknown) => (Array.isArray(list) ? list : []).map((w) => String((w as { word?: unknown }).word ?? "")).filter(Boolean);
	// Datamuse's synonym list isn't in a useful order ("halcyon" before "joyful"), but its
	// "means like" list is ranked by relevance: order the synonyms by their place in it.
	const rank = new Map(words(like).map((w, i) => [w.toLowerCase(), i]));
	const ordered = words(syn).map((w, i) => ({ w, r: rank.get(w.toLowerCase()) ?? 1000 + i })).sort((a, b) => a.r - b.r).map((x) => x.w);
	const seen = new Set<string>([key]);
	const out: string[] = [];
	for (const w of [...ordered, ...words(like)]) {
		const k = w.toLowerCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(w);
	}
	synonymCache.set(key, out);
	return out.slice(0, max);
}

/** Definitions for a word, or null if neither source knows it. */
export async function define(word: string): Promise<Definition | null> {
	const key = word.trim().toLowerCase();
	if (!key) return null;
	if (definitionCache.has(key)) return definitionCache.get(key) ?? null;
	const result = (await fromFreeDictionary(key)) ?? (await fromWiktionary(key));
	definitionCache.set(key, result);
	return result;
}

async function fromFreeDictionary(word: string): Promise<Definition | null> {
	const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
	if (!Array.isArray(data) || !data.length) return null;
	type Entry = { word?: string; phonetic?: string; phonetics?: Array<{ text?: string }>; meanings?: Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string; example?: string }> }> };
	const entries = data as Entry[];
	// Entries for the same word (e.g. noun and verb senses) are merged by part of speech.
	const byPart = new Map<string, Meaning>();
	for (const e of entries) {
		for (const m of e.meanings ?? []) {
			const part = m.partOfSpeech ?? "";
			const meaning = byPart.get(part) ?? { partOfSpeech: part, definitions: [] };
			for (const d of m.definitions ?? []) if (d.definition) meaning.definitions.push({ text: d.definition, example: d.example });
			byPart.set(part, meaning);
		}
	}
	const meanings = [...byPart.values()].filter((m) => m.definitions.length);
	if (!meanings.length) return null;
	const first = entries[0];
	return {
		word: first.word ?? word,
		phonetic: first.phonetic ?? first.phonetics?.find((p) => p.text)?.text,
		meanings,
		source: "Free Dictionary",
		url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
	};
}

async function fromWiktionary(word: string): Promise<Definition | null> {
	const data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`) as
		{ en?: Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string; examples?: string[] }> }> } | null;
	const english = data?.en ?? [];
	const meanings: Meaning[] = english.map((m) => ({
		partOfSpeech: (m.partOfSpeech ?? "").toLowerCase(),
		definitions: (m.definitions ?? [])
			.map((d) => ({ text: stripHtml(d.definition ?? ""), example: d.examples?.[0] ? stripHtml(d.examples[0]) : undefined }))
			.filter((d) => d.text),
	})).filter((m) => m.definitions.length);
	if (!meanings.length) return null;
	return { word, meanings, source: "Wiktionary", url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}` };
}

/**
 * Wiktionary's definitions are HTML snippets; keep just the text. Parsed with DOMParser, which
 * neither runs scripts nor loads images, so nothing in a definition can execute.
 */
function stripHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The replacement spelled like the word it replaces: "Happy" → "Glad", "HAPPY" → "GLAD". */
export function matchCase(original: string, replacement: string): string {
	if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) return replacement.toUpperCase();
	if (/^[A-Z]/.test(original)) return replacement[0].toUpperCase() + replacement.slice(1);
	return replacement;
}
