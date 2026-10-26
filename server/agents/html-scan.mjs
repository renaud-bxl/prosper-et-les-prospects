// Parcours conservateur, linéaire : du HTML incomplet ne déclenche jamais une recherche regex
// répétée sur toute la fin du document. Aucun script n'est exécuté.
const HIDDEN = new Set(['script', 'style', 'noscript', 'svg', 'template']);
const BREAKS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article']);
const MAX_TAG = 8192;

function closingAt(lower, name, from) {
  let position = from;
  for (;;) {
    const index = lower.indexOf('</' + name, position);
    if (index < 0) return -1;
    const next = lower[index + name.length + 2];
    if (next === '>' || next === '/' || /\s/.test(next ?? '')) return index;
    position = index + name.length + 2;
  }
}

export function* htmlTags(input, { skipHidden = false, limit = 10000 } = {}) {
  const html = String(input), lower = html.toLowerCase();
  let position = 0, count = 0;
  for (;;) {
    const index = html.indexOf('<', position);
    if (index < 0) return;
    const end = html.indexOf('>', index + 1);
    if (end < 0 || ++count > limit) { yield { index, end: html.length, hidden: true, tag: '', attrs: '', raw: '' }; return; }
    position = end + 1;
    const raw = html.slice(index, Math.min(end + 1, index + MAX_TAG));
    const match = raw.match(/^<(\/?)([a-z][\w:-]*)\b/i);
    if (!match || end - index > MAX_TAG) { yield { index, end: position, hidden: true, tag: '', attrs: '', raw: '' }; continue; }
    const tag = match[2].toLowerCase(), closing = Boolean(match[1]);
    if (skipHidden && !closing && HIDDEN.has(tag)) {
      const close = closingAt(lower, tag, position), closeEnd = close < 0 ? -1 : html.indexOf('>', close);
      position = closeEnd < 0 ? html.length : closeEnd + 1;
      yield { index, end: position, hidden: true, tag, closing, attrs: '', raw: '' };
      if (closeEnd < 0) return;
      continue;
    }
    yield { index, end: position, tag, closing, attrs: raw.slice(match[0].length, -1), raw, hidden: false };
  }
}

export function visibleHtmlText(input) {
  const html = String(input), chunks = [];
  let last = 0;
  for (const token of htmlTags(html, { skipHidden: true })) {
    chunks.push(html.slice(last, token.index));
    chunks.push(token.tag === 'br' || token.closing && BREAKS.has(token.tag) ? '\n' : ' ');
    last = token.end;
  }
  chunks.push(html.slice(last));
  const entities = { nbsp: ' ', amp: '&', '#039': '’', rsquo: '’', '#8217': '’', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ocirc: 'ô', quot: '"' };
  return chunks.join('').replace(/&(?:nbsp|amp|#039|rsquo|#8217|eacute|egrave|agrave|ccedil|ocirc|quot);/gi, (value) => entities[value.slice(1, -1).toLowerCase()])
    .replace(/[^\S\n]+/g, ' ').replace(/ *\n(?: *\n)* */g, '\n').trim();
}

export function* htmlElements(input, name, limit = 1000) {
  const html = String(input), lower = html.toLowerCase();
  let position = 0, count = 0;
  while (count < limit) {
    const index = lower.indexOf('<' + name, position);
    if (index < 0) return;
    const next = lower[index + name.length + 1];
    position = index + name.length + 1;
    if (next !== '>' && next !== '/' && !/\s/.test(next ?? '')) continue;
    const openEnd = html.indexOf('>', position);
    if (openEnd < 0) return;
    const close = closingAt(lower, name, openEnd + 1);
    if (close < 0) return;
    const closeEnd = html.indexOf('>', close);
    if (closeEnd < 0) return;
    position = closeEnd + 1;
    if (openEnd - index > MAX_TAG) continue;
    count++;
    yield { attrs: html.slice(index + name.length + 1, openEnd), content: html.slice(openEnd + 1, close), index, end: position };
  }
}

export function htmlLinks(html, base) {
  const result = [];
  for (const element of htmlElements(html, 'a', 1000)) {
    const href = element.attrs.match(/(?:^|\s)href\s*=\s*["']([^"'#]+)["']/i)?.[1];
    if (!href) continue;
    try { result.push({ url: new URL(href.trim(), base).href, text: visibleHtmlText(element.content).trim().toLowerCase() }); } catch {}
  }
  return result;
}
