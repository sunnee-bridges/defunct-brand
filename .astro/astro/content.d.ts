declare module 'astro:content' {
	interface Render {
		'.mdx': Promise<{
			Content: import('astro').MarkdownInstance<{}>['Content'];
			headings: import('astro').MarkdownHeading[];
			remarkPluginFrontmatter: Record<string, any>;
			components: import('astro').MDXInstance<{}>['components'];
		}>;
	}
}

declare module 'astro:content' {
	interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}
}

declare module 'astro:content' {
	type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	export type CollectionKey = keyof AnyEntryMap;
	export type CollectionEntry<C extends CollectionKey> = Flatten<AnyEntryMap[C]>;

	export type ContentCollectionKey = keyof ContentEntryMap;
	export type DataCollectionKey = keyof DataEntryMap;

	type AllValuesOf<T> = T extends any ? T[keyof T] : never;
	type ValidContentEntrySlug<C extends keyof ContentEntryMap> = AllValuesOf<
		ContentEntryMap[C]
	>['slug'];

	/** @deprecated Use `getEntry` instead. */
	export function getEntryBySlug<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		// Note that this has to accept a regular string too, for SSR
		entrySlug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;

	/** @deprecated Use `getEntry` instead. */
	export function getDataEntryById<C extends keyof DataEntryMap, E extends keyof DataEntryMap[C]>(
		collection: C,
		entryId: E,
	): Promise<CollectionEntry<C>>;

	export function getCollection<C extends keyof AnyEntryMap, E extends CollectionEntry<C>>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	export function getCollection<C extends keyof AnyEntryMap>(
		collection: C,
		filter?: (entry: CollectionEntry<C>) => unknown,
	): Promise<CollectionEntry<C>[]>;

	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(entry: {
		collection: C;
		slug: E;
	}): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(entry: {
		collection: C;
		id: E;
	}): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof ContentEntryMap,
		E extends ValidContentEntrySlug<C> | (string & {}),
	>(
		collection: C,
		slug: E,
	): E extends ValidContentEntrySlug<C>
		? Promise<CollectionEntry<C>>
		: Promise<CollectionEntry<C> | undefined>;
	export function getEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<CollectionEntry<C> | undefined>;

	/** Resolve an array of entry references from the same collection */
	export function getEntries<C extends keyof ContentEntryMap>(
		entries: {
			collection: C;
			slug: ValidContentEntrySlug<C>;
		}[],
	): Promise<CollectionEntry<C>[]>;
	export function getEntries<C extends keyof DataEntryMap>(
		entries: {
			collection: C;
			id: keyof DataEntryMap[C];
		}[],
	): Promise<CollectionEntry<C>[]>;

	export function render<C extends keyof AnyEntryMap>(
		entry: AnyEntryMap[C][string],
	): Promise<RenderResult>;

	export function reference<C extends keyof AnyEntryMap>(
		collection: C,
	): import('astro/zod').ZodEffects<
		import('astro/zod').ZodString,
		C extends keyof ContentEntryMap
			? {
					collection: C;
					slug: ValidContentEntrySlug<C>;
				}
			: {
					collection: C;
					id: keyof DataEntryMap[C];
				}
	>;
	// Allow generic `string` to avoid excessive type errors in the config
	// if `dev` is not running to update as you edit.
	// Invalid collection names will be caught at build time.
	export function reference<C extends string>(
		collection: C,
	): import('astro/zod').ZodEffects<import('astro/zod').ZodString, never>;

	type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	type InferEntrySchema<C extends keyof AnyEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ContentConfig['collections'][C]>['schema']>
	>;

	type ContentEntryMap = {
		"articles": {
"50-brands-that-no-longer-exist.mdx.md": {
	id: "50-brands-that-no-longer-exist.mdx.md";
  slug: "50-brands-that-no-longer-existmdx";
  body: string;
  collection: "articles";
  data: any
} & { render(): Render[".md"] };
"blockbuster-vs-netflix.mdx": {
	id: "blockbuster-vs-netflix.mdx";
  slug: "blockbuster-vs-netflix";
  body: string;
  collection: "articles";
  data: any
} & { render(): Render[".mdx"] };
"what-happened-to-pan-am.mdx.md": {
	id: "what-happened-to-pan-am.mdx.md";
  slug: "what-happened-to-pan-ammdx";
  body: string;
  collection: "articles";
  data: any
} & { render(): Render[".md"] };
};
"post": Record<string, {
  id: string;
  slug: string;
  body: string;
  collection: "post";
  data: InferEntrySchema<"post">;
  render(): Render[".md"];
}>;

	};

	type DataEntryMap = {
		"brands": {
"aim": {
	id: "aim";
  collection: "brands";
  data: any
};
"american-apparel-original": {
	id: "american-apparel-original";
  collection: "brands";
  data: any
};
"blackberry-os-phones": {
	id: "blackberry-os-phones";
  collection: "brands";
  data: any
};
"blockbuster": {
	id: "blockbuster";
  collection: "brands";
  data: any
};
"borders": {
	id: "borders";
  collection: "brands";
  data: any
};
"casual-corner": {
	id: "casual-corner";
  collection: "brands";
  data: any
};
"circuit-city": {
	id: "circuit-city";
  collection: "brands";
  data: any
};
"compaq": {
	id: "compaq";
  collection: "brands";
  data: any
};
"jet-retail": {
	id: "jet-retail";
  collection: "brands";
  data: any
};
"kb-toys": {
	id: "kb-toys";
  collection: "brands";
  data: any
};
"kodak-consumer-cameras": {
	id: "kodak-consumer-cameras";
  collection: "brands";
  data: any
};
"lego-universe": {
	id: "lego-universe";
  collection: "brands";
  data: any
};
"linens-n-things": {
	id: "linens-n-things";
  collection: "brands";
  data: any
};
"napster-original": {
	id: "napster-original";
  collection: "brands";
  data: any
};
"netscape": {
	id: "netscape";
  collection: "brands";
  data: any
};
"palm": {
	id: "palm";
  collection: "brands";
  data: any
};
"pan-am": {
	id: "pan-am";
  collection: "brands";
  data: any
};
"pebble": {
	id: "pebble";
  collection: "brands";
  data: any
};
"pets-com": {
	id: "pets-com";
  collection: "brands";
  data: any
};
"sears-canada": {
	id: "sears-canada";
  collection: "brands";
  data: any
};
"sega-dreamcast": {
	id: "sega-dreamcast";
  collection: "brands";
  data: any
};
"twa": {
	id: "twa";
  collection: "brands";
  data: any
};
"woolworth-us": {
	id: "woolworth-us";
  collection: "brands";
  data: any
};
"yahoo-messenger": {
	id: "yahoo-messenger";
  collection: "brands";
  data: any
};
"zune": {
	id: "zune";
  collection: "brands";
  data: any
};
};
"brands_src": {
"aim": {
	id: "aim";
  collection: "brands_src";
  data: any
};
"american-apparel-original": {
	id: "american-apparel-original";
  collection: "brands_src";
  data: any
};
"blackberry-os-phones": {
	id: "blackberry-os-phones";
  collection: "brands_src";
  data: any
};
"blockbuster": {
	id: "blockbuster";
  collection: "brands_src";
  data: any
};
"borders": {
	id: "borders";
  collection: "brands_src";
  data: any
};
"casual-corner": {
	id: "casual-corner";
  collection: "brands_src";
  data: any
};
"circuit-city": {
	id: "circuit-city";
  collection: "brands_src";
  data: any
};
"compaq": {
	id: "compaq";
  collection: "brands_src";
  data: any
};
"jet-retail": {
	id: "jet-retail";
  collection: "brands_src";
  data: any
};
"kb-toys": {
	id: "kb-toys";
  collection: "brands_src";
  data: any
};
"kodak-consumer-cameras": {
	id: "kodak-consumer-cameras";
  collection: "brands_src";
  data: any
};
"lego-universe": {
	id: "lego-universe";
  collection: "brands_src";
  data: any
};
"linens-n-things": {
	id: "linens-n-things";
  collection: "brands_src";
  data: any
};
"napster-original": {
	id: "napster-original";
  collection: "brands_src";
  data: any
};
"netscape": {
	id: "netscape";
  collection: "brands_src";
  data: any
};
"palm": {
	id: "palm";
  collection: "brands_src";
  data: any
};
"pan-am": {
	id: "pan-am";
  collection: "brands_src";
  data: any
};
"pebble": {
	id: "pebble";
  collection: "brands_src";
  data: any
};
"pets-com": {
	id: "pets-com";
  collection: "brands_src";
  data: any
};
"sears-canada": {
	id: "sears-canada";
  collection: "brands_src";
  data: any
};
"sega-dreamcast": {
	id: "sega-dreamcast";
  collection: "brands_src";
  data: any
};
"twa": {
	id: "twa";
  collection: "brands_src";
  data: any
};
"woolworth-us": {
	id: "woolworth-us";
  collection: "brands_src";
  data: any
};
"yahoo-messenger": {
	id: "yahoo-messenger";
  collection: "brands_src";
  data: any
};
"zune": {
	id: "zune";
  collection: "brands_src";
  data: any
};
};
"topics": {
"topics": {
	id: "topics";
  collection: "topics";
  data: InferEntrySchema<"topics">
};
};

	};

	type AnyEntryMap = ContentEntryMap & DataEntryMap;

	export type ContentConfig = typeof import("../../src/content/config.js");
}
