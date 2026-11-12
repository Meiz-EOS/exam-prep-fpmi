import { describe, expect, it } from "vitest";
import { routeFromHash } from "../src/ui/router";
import { pickLang, strings } from "../src/ui/i18n";

describe("router", () => {
  const ids = ["sdachi", "tests"];
  it("known hash", () => expect(routeFromHash("#tests", ids)).toBe("tests"));
  it("empty or unknown hash falls back to the first module", () => {
    expect(routeFromHash("", ids)).toBe("sdachi");
    expect(routeFromHash("#nope", ids)).toBe("sdachi");
    expect(routeFromHash("#/tests", ids)).toBe("sdachi");
  });
});

describe("i18n", () => {
  it("picks language from the system list", () => {
    expect(pickLang(["ru-RU", "en"])).toBe("ru");
    expect(pickLang(["en-US"])).toBe("en");
    expect(pickLang([])).toBe("en");
  });
  it("ru and en have the same keys", () => {
    expect(Object.keys(strings("en")).sort()).toEqual(Object.keys(strings("ru")).sort());
  });
});
