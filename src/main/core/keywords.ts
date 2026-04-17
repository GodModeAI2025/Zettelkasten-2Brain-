const STOPWORDS = new Set([
  // Deutsch
  'aber', 'alle', 'allem', 'allen', 'aller', 'alles', 'also', 'auch', 'auf', 'aus',
  'bei', 'beim', 'beispielsweise', 'bereits', 'bevor', 'bezueglich',
  'dabei', 'damit', 'dann', 'dass', 'davon', 'dein', 'deine', 'denen', 'denn',
  'dessen', 'diese', 'diesem', 'diesen', 'dieser', 'dieses', 'doch', 'dort', 'durch',
  'eben', 'eher', 'eine', 'einem', 'einen', 'einer', 'eines', 'einige', 'einigen',
  'einmal', 'entweder', 'erst', 'etwa', 'etwas',
  'fuer', 'fur',
  'ganz', 'gegen', 'genau', 'gerade', 'gerne', 'geworden',
  'haben', 'hatte', 'hatten', 'hier', 'hinter',
  'ihnen', 'ihrem', 'ihrer', 'immer', 'inzwischen', 'ist',
  'jede', 'jedem', 'jeden', 'jeder', 'jedes', 'jene', 'jetzt',
  'kann', 'kannst', 'kaum', 'keine', 'keinem', 'keinen', 'keiner', 'keines',
  'koennen', 'konnen', 'konnte', 'konnten',
  'lassen', 'lasst',
  'machen', 'macht', 'manche', 'manchem', 'manchen', 'mancher', 'manches', 'mehr',
  'muesste', 'musste', 'mussten',
  'nach', 'nachdem', 'neben', 'nicht', 'nichts', 'noch', 'nunmehr',
  'oder', 'ohne',
  'schon', 'sehr', 'sein', 'seine', 'seinem', 'seinen', 'seiner', 'seines',
  'selbst', 'sich', 'sind', 'solche', 'solchem', 'solchen', 'solcher', 'solches',
  'sollen', 'sollst', 'sollte', 'sollten', 'sondern', 'sonst',
  'ueber', 'uber', 'unter', 'unserem', 'unserer', 'unseres',
  'viel', 'viele', 'vielen', 'vielleicht', 'vollkommen', 'vom', 'von', 'vor',
  'waehrend', 'wahrend', 'ware', 'waren', 'warum', 'weil', 'welche', 'welchem',
  'welchen', 'welcher', 'welches', 'wenn', 'werden', 'weshalb', 'wessen',
  'wieder', 'wird', 'wirst', 'wollen', 'wollte', 'wollten', 'wurde', 'wurden',
  'zwar', 'zwischen',
  // Englisch
  'about', 'above', 'after', 'again', 'against', 'also', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'could', 'does', 'doing', 'down', 'during',
  'each', 'either', 'every', 'from', 'further',
  'have', 'having', 'here',
  'into', 'itself', 'just',
  'more', 'most', 'much', 'must',
  'once', 'only', 'other', 'over',
  'same', 'should', 'since', 'some', 'such',
  'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through',
  'under', 'until', 'upon',
  'very',
  'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would',
  'your', 'yours', 'yourself',
]);

const TOKEN_REGEX = /[a-zäöüß0-9][a-zäöüß0-9-]{3,}/g;

export function tokenize(content: string): string[] {
  const tokens = content.toLowerCase().match(TOKEN_REGEX) || [];
  const out: string[] = [];
  for (const tok of tokens) {
    if (STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

export function extractKeywords(content: string, limit = 30): string[] {
  const freq = new Map<string, number>();
  for (const tok of tokenize(content)) {
    freq.set(tok, (freq.get(tok) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([tok]) => tok);
}
