/** A parsed XML element. Enough of XML for the 3MF parts this app writes: elements, attributes, text. */
export interface El { tag: string; attrs: Record<string, string>; children: El[]; text: string }

const unescape = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Parse an XML document into its root element. Throws on mismatched tags. */
export function parseXml(src: string): El {
  const body = src.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const root: El = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(body)); ) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) { top.text += unescape(m[5]); continue; }
    const [, close, tag, attrSrc, self] = m;
    if (close) {
      if (top.tag !== tag) throw new Error(`mismatched </${tag}>, open <${top.tag}>`);
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrSrc!.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]!] = unescape(a[2]!);
    const el: El = { tag: tag!, attrs, children: [], text: '' };
    top.children.push(el);
    if (!self) stack.push(el);
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.tag}>`);
  if (root.children.length !== 1) throw new Error('expected one root element');
  return root.children[0]!;
}

/** Direct children with this tag. */
export const kids = (e: El, tag: string): El[] => e.children.filter((c) => c.tag === tag);
/** The single direct child with this tag. */
export const kid = (e: El, tag: string): El => {
  const k = kids(e, tag);
  if (k.length !== 1) throw new Error(`<${e.tag}> has ${k.length} <${tag}>`);
  return k[0]!;
};
/** Every descendant with this tag, document order. */
export const all = (e: El, tag: string): El[] => e.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...all(c, tag)]);
/** `<metadata key=… value=…/>` children as a map. */
export const metaOf = (e: El): Record<string, string> =>
  Object.fromEntries(kids(e, 'metadata').map((m) => [m.attrs.key!, m.attrs.value!]));
