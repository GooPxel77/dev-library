import { describe, expect, it } from "vitest";
import { selectHomeCurations } from "../../lib/utils/home-curations";

describe("homepage recommendation payload", () => {
  it("keeps both languages and every intent while bounding large catalogs", () => {
    const resources = ["book", "app", "interactive", "documentation"].flatMap(type =>
      ["en", "zh"].flatMap(language => Array.from({ length: 1000 }, (_, i) => ({
        id: `${type}-${language}-${i}`, type, language,
      }))),
    );
    const selected = selectHomeCurations(resources, new Set(["book-zh-999"]));
    expect(selected).toHaveLength(97);
    expect(new Set(selected.map(r => r.id)).size).toBe(selected.length);
    expect(selected.some(r => r.id === "book-zh-999")).toBe(true);
    for (const type of ["book", "app", "interactive", "documentation"]) {
      for (const language of ["en", "zh"]) {
        expect(selected.filter(r => r.type === type && r.language === language).length).toBeGreaterThanOrEqual(12);
      }
    }
    expect(selectHomeCurations(resources, new Set(["book-zh-999"]))).toEqual(selected);
  });

  it("handles empty and sparse catalogs without duplicate recommendations", () => {
    expect(selectHomeCurations([], new Set())).toEqual([]);
    const resource = { id: "one", type: "book", language: "en" };
    expect(selectHomeCurations([resource], new Set(["one"]))).toEqual([resource]);
  });
});
