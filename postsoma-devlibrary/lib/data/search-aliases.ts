/** Exact topic names with common simplified, traditional, and English forms. */
const TOPIC_GROUPS: ReadonlyArray<readonly [string, string, string]> = [
  ["机器学习", "機器學習", "machine learning"],
  ["数据库", "資料庫", "database"],
  ["人工智能", "人工智慧", "artificial intelligence"],
  ["计算机科学", "計算機科學", "computer science"],
];

/** Keep technical names such as C++ and Node.js intact inside a Chinese learning goal. */
export function normalizeLearningQuery(query: string): string {
  return query.normalize("NFKC").trim()
    .replace(/^(?:我(?:想要|想|希望)|想要|想)(?:学习|學習|学|學|了解)\s*/, "")
    .replace(/([\u3400-\u9fff])([a-zA-Z0-9])/g, "$1 $2")
    .replace(/([a-zA-Z0-9+#])([\u3400-\u9fff])/g, "$1 $2")
    .trim();
}

export function getSearchAlias(query: string): string | undefined {
  const term = normalizeLearningQuery(query).toLowerCase();
  return TOPIC_GROUPS.find(([simplified, traditional]) => term === simplified || term === traditional)?.[2];
}

export function getSearchAliases(query: string): string[] {
  const term = normalizeLearningQuery(query).toLowerCase();
  const group = TOPIC_GROUPS.find(([simplified, traditional]) => term === simplified || term === traditional);
  return group ? group.filter((alias) => alias !== term) : [];
}
