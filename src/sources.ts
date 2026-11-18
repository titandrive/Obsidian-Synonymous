import { requestUrl } from "obsidian";

/*
 * Where words come from. Several sources for synonyms and for definitions; the settings decide which
 * are on and in what order. Synonyms come from every source that's on, top source first, the others
 * adding words it didn't have. Definitions come from the first source that knows the word.
 * Answers are kept for the session, so looking up the same word again is instant.
 *
 *   Synonyms:    Merriam-Webster thesaurus (key), Big Huge Thesaurus (key), Free Dictionary, Datamuse
 *   Definitions: Merriam-Webster dictionary (key), Free Dictionary, Wiktionary
 */

export type SynonymSourceId = "merriam-webster" | "big-huge" | "free-dictionary" | "datamuse";
export type DefinitionSourceId = "merriam-webster" | "free-dictionary" | "wiktionary";

export interface Keys {
	mwThesaurus: string;
	mwDictionary: string;
	bigHuge: string;
}

/** A group of synonyms for one meaning of the word. `heading` names the meaning, when the source gives one. */
export interface SynonymGroup {
	heading?: string;
	words: string[];
}

export interface Meaning {
	partOfSpeech: string;
	definitions: Array<{ text: string; example?: string }>;
}

export interface Definition {
	word: string;
	phonetic?: string;
	meanings: Meaning[];
	source: string;
	url: string;
}

export const SYNONYM_SOURCES: Record<SynonymSourceId, { name: string; needsKey?: keyof Keys }> = {
	"merriam-webster": { name: "Merriam-Webster", needsKey: "mwThesaurus" },
	"big-huge": { name: "Big Huge Thesaurus", needsKey: "bigHuge" },
	"free-dictionary": { name: "Free Dictionary" },
	"datamuse": { name: "Datamuse" },
};

export const DEFINITION_SOURCES: Record<DefinitionSourceId, { name: string; needsKey?: keyof Keys }> = {
	"merriam-webster": { name: "Merriam-Webster", needsKey: "mwDictionary" },
	"free-dictionary": { name: "Free Dictionary" },
	"wiktionary": { name: "Wiktionary" },
};

async function getJson(url: string): Promise<unknown | null> {
	try {
		const res = await requestUrl({ url, throw: false });
		if (res.status < 200 || res.status >= 300) return null;
		return JSON.parse(res.text);
	} catch {
		return null; // network trouble, or not JSON (e.g. Merriam-Webster's "Invalid API key" text)
	}
}

/** Results of a request, shared by everything that asks for the same URL this session. */
const cache = new Map<string, Promise<unknown | null>>();
function cached(url: string): Promise<unknown | null> {
	let p = cache.get(url);
	if (!p) {
		p = getJson(url);
		cache.set(url, p);
	}
	return p;
}

const enc = encodeURIComponent;

// ── Datamuse: frequencies and closeness, used to rank and filter every source's words ──────────────

/** Words rarer than this (uses per million words of text) are left out: "quaternate", "riant". */
const MIN_FREQUENCY = 0.5;

type DatamuseWord = { word?: string; tags?: string[] };
const datamuseWords = (list: unknown): Array<{ word: string; tags?: string[] }> =>
	(Array.isArray(list) ? list : []).filter((w): w is { word: string; tags?: string[] } => typeof (w as DatamuseWord).word === "string");
const frequencyOf = (w: DatamuseWord): number | null => {
	const tag = w.tags?.find((t) => t.startsWith("f:"));
	return tag ? Number(tag.slice(2)) : null;
};

/** How common words are, and how close in meaning to `key` Datamuse rates them (lower rank is closer). */
async function datamuseRanking(key: string): Promise<{ frequency: Map<string, number>; rank: Map<string, number>; like: string[]; syn: string[] }> {
	const [syn, like] = await Promise.all([
		cached(`https://api.datamuse.com/words?rel_syn=${enc(key)}&md=f&max=60`),
		cached(`https://api.datamuse.com/words?ml=${enc(key)}&md=f&max=100`),
	]);
	const synWords = datamuseWords(syn), likeWords = datamuseWords(like);
	const frequency = new Map<string, number>();
	for (const w of [...synWords, ...likeWords]) {
		const f = frequencyOf(w);
		if (f !== null) frequency.set(w.word.toLowerCase(), f);
	}
	return { frequency, rank: new Map(likeWords.map((w, i) => [w.word.toLowerCase(), i])), like: likeWords.map((w) => w.word), syn: synWords.map((w) => w.word) };
}

/** Fill in how common the given single words are (one small Datamuse request each, cached). */
async function lookUpFrequencies(words: string[], frequency: Map<string, number>): Promise<void> {
	const missing = [...new Set(words.map((w) => w.toLowerCase()))].filter((w) => !frequency.has(w) && !w.includes(" ")).slice(0, 40);
	await Promise.all(missing.map(async (w) => {
		const found = datamuseWords(await cached(`https://api.datamuse.com/words?sp=${enc(w)}&md=f&max=1`))[0];
		frequency.set(w, found && found.word.toLowerCase() === w ? (frequencyOf(found) ?? 0) : 0);
	}));
}

// ── Synonym sources: each returns groups of words, or null if it has nothing ──────────────────────

/** Merriam-Webster's thesaurus: synonyms grouped by meaning, each with a short description of it. */
async function mwSynonyms(key: string, apiKey: string): Promise<SynonymGroup[] | null> {
	const data = await cached(`https://www.dictionaryapi.com/api/v3/references/thesaurus/json/${enc(key)}?key=${enc(apiKey)}`);
	if (!Array.isArray(data)) return null;
	type Entry = { meta?: { id?: string; syns?: string[][] }; fl?: string; shortdef?: string[] };
	const groups: SynonymGroup[] = [];
	// Only entries for the word itself (its id is the word, or "word:2"); not "happy-go-lucky".
	for (const e of data as Entry[]) {
		if (typeof e !== "object" || !e?.meta?.id || e.meta.id.split(":")[0].toLowerCase() !== key) continue;
		(e.meta.syns ?? []).forEach((words, i) => {
			const sense = e.shortdef?.[i];
			if (words.length) groups.push({ heading: [e.fl, sense].filter(Boolean).join(": "), words });
		});
	}
	return groups.length ? groups : null;
}

/** Big Huge Thesaurus: synonyms (then similar words) per part of speech. */
async function bigHugeSynonyms(key: string, apiKey: string): Promise<SynonymGroup[] | null> {
	const data = await cached(`https://words.bighugelabs.com/api/2/${enc(apiKey)}/${enc(key)}/json`) as Record<string, { syn?: string[]; sim?: string[] }> | null;
	if (!data || typeof data !== "object") return null;
	const groups = Object.entries(data)
		.map(([pos, v]) => ({ heading: pos, words: [...(v?.syn ?? []), ...(v?.sim ?? [])] }))
		.filter((g) => g.words.length);
	return groups.length ? groups : null;
}

/** The Free Dictionary's synonyms (from Wiktionary, chosen by people), per part of speech. */
async function freeDictionarySynonyms(key: string): Promise<SynonymGroup[] | null> {
	const data = await cached(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(key)}`);
	if (!Array.isArray(data)) return null;
	type Entry = { meanings?: Array<{ partOfSpeech?: string; synonyms?: string[]; definitions?: Array<{ synonyms?: string[] }> }> };
	const byPart = new Map<string, string[]>();
	for (const e of data as Entry[]) for (const m of e.meanings ?? []) {
		const list = byPart.get(m.partOfSpeech ?? "") ?? [];
		list.push(...(m.synonyms ?? []));
		for (const d of m.definitions ?? []) list.push(...(d.synonyms ?? []));
		byPart.set(m.partOfSpeech ?? "", list);
	}
	const groups = [...byPart].map(([pos, words]) => ({ heading: pos || undefined, words })).filter((g) => g.words.length);
	return groups.length ? groups : null;
}

/** Datamuse's synonyms (from WordNet). The caller adds close "means like" words when lists run short. */
async function datamuseSynonyms(key: string): Promise<SynonymGroup[] | null> {
	const { syn } = await datamuseRanking(key);
	return syn.length ? [{ words: syn }] : null;
}

/**
 * Synonyms for a word or short phrase from the sources that are on, in their order. The top source's
 * groups (by meaning) come first; lower sources add only words not already listed. Every word is
 * ranked by closeness of meaning within its group, rare words are dropped, and close "means like"
 * words fill in when everything together is still short. The word itself is never included.
 */
export async function synonyms(word: string, order: SynonymSourceId[], keys: Keys, max: number): Promise<SynonymGroup[]> {
	const key = word.trim().toLowerCase();
	if (!key) return [];
	const fetchers: Record<SynonymSourceId, () => Promise<SynonymGroup[] | null>> = {
		"merriam-webster": () => (keys.mwThesaurus ? mwSynonyms(key, keys.mwThesaurus) : Promise.resolve(null)),
		"big-huge": () => (keys.bigHuge ? bigHugeSynonyms(key, keys.bigHuge) : Promise.resolve(null)),
		"free-dictionary": () => freeDictionarySynonyms(key),
		"datamuse": () => datamuseSynonyms(key),
	};
	const [results, ranking] = await Promise.all([Promise.all(order.map((id) => fetchers[id]())), datamuseRanking(key)]);
	const { frequency, rank, like } = ranking;
	await lookUpFrequencies(results.flat().flatMap((g) => g?.words ?? []), frequency);
	const common = (w: string, min = MIN_FREQUENCY) => {
		const f = frequency.get(w.toLowerCase());
		return f === undefined ? w.includes(" ") : f >= min; // phrases ("fully grown") have no frequency: keep
	};
	const byCloseness = (list: string[]) => list.map((w, i) => ({ w, r: rank.get(w.toLowerCase()) ?? 1000 + i })).sort((a, b) => a.r - b.r).map((x) => x.w);

	const seen = new Set<string>([key]);
	const out: SynonymGroup[] = [];
	let count = 0;
	const take = (words: string[]) => {
		const kept: string[] = [];
		for (const w of words) {
			const k = w.toLowerCase();
			if (seen.has(k) || !common(w) || count >= max) continue;
			seen.add(k);
			kept.push(w);
			count++;
		}
		return kept;
	};
	results.forEach((groups, i) => {
		if (!groups) return;
		// The first source that answered keeps its groups (meanings); later ones add their extra words in one group.
		if (!out.length) {
			for (const g of groups) {
				const words = take(byCloseness(g.words));
				if (words.length) out.push({ heading: g.heading, words });
			}
		} else {
			const words = take(byCloseness(groups.flatMap((g) => g.words)));
			if (words.length) out.push({ heading: `More from ${SYNONYM_SOURCES[order[i]].name}`, words });
		}
	});
	// Still short: the closest related words, as long as they're everyday words.
	if (count < 8) {
		const words = take(like.filter((w) => common(w, 2)).slice(0, 12));
		if (words.length) out.push({ heading: out.length ? "Related" : undefined, words });
	}
	return out;
}

// ── Definitions ───────────────────────────────────────────────────────────────────────────────

/** Definitions from the first source (in the given order) that knows the word, or null. */
export async function define(word: string, order: DefinitionSourceId[], keys: Keys): Promise<Definition | null> {
	const key = word.trim().toLowerCase();
	if (!key) return null;
	for (const id of order) {
		const def = id === "merriam-webster" ? (keys.mwDictionary ? await fromMerriamWebster(key, keys.mwDictionary) : null)
			: id === "free-dictionary" ? await fromFreeDictionary(key)
			: await fromWiktionary(key);
		if (def) return def;
	}
	return null;
}

async function fromMerriamWebster(word: string, apiKey: string): Promise<Definition | null> {
	const data = await cached(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${enc(word)}?key=${enc(apiKey)}`);
	if (!Array.isArray(data)) return null;
	type Entry = { meta?: { id?: string }; hwi?: { prs?: Array<{ mw?: string }> }; fl?: string; shortdef?: string[] };
	const entries = (data as Entry[]).filter((e) => typeof e === "object" && e?.meta?.id?.split(":")[0].toLowerCase() === word);
	const byPart = new Map<string, Meaning>();
	for (const e of entries) {
		const part = e.fl ?? "";
		const m = byPart.get(part) ?? { partOfSpeech: part, definitions: [] };
		for (const d of e.shortdef ?? []) m.definitions.push({ text: d });
		byPart.set(part, m);
	}
	const meanings = [...byPart.values()].filter((m) => m.definitions.length);
	if (!meanings.length) return null;
	const pr = entries.find((e) => e.hwi?.prs?.[0]?.mw)?.hwi?.prs?.[0]?.mw;
	return { word, phonetic: pr ? `\\${pr}\\` : undefined, meanings, source: "Merriam-Webster", url: `https://www.merriam-webster.com/dictionary/${enc(word)}` };
}

async function fromFreeDictionary(word: string): Promise<Definition | null> {
	const data = await cached(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(word)}`);
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
		url: `https://en.wiktionary.org/wiki/${enc(word)}`,
	};
}

async function fromWiktionary(word: string): Promise<Definition | null> {
	const data = await cached(`https://en.wiktionary.org/api/rest_v1/page/definition/${enc(word)}`) as
		{ en?: Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string; examples?: string[] }> }> } | null;
	const english = data?.en ?? [];
	const meanings: Meaning[] = english.map((m) => ({
		partOfSpeech: (m.partOfSpeech ?? "").toLowerCase(),
		definitions: (m.definitions ?? [])
			.map((d) => ({ text: stripHtml(d.definition ?? ""), example: d.examples?.[0] ? stripHtml(d.examples[0]) : undefined }))
			.filter((d) => d.text),
	})).filter((m) => m.definitions.length);
	if (!meanings.length) return null;
	return { word, meanings, source: "Wiktionary", url: `https://en.wiktionary.org/wiki/${enc(word)}` };
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
