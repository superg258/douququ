import { describe, expect, it } from "vitest";

import { isPageFullscreenActive, setPageFullscreenLock } from "@/lib/fullscreen-api";

describe("fullscreen-api", () => {
  const createMockElement = (overflow = "") => {
    const classes = new Set<string>();

    return {
      style: { overflow },
      dataset: {} as Record<string, string>,
      classList: {
        add: (...tokens: string[]) => tokens.forEach((token) => classes.add(token)),
        remove: (...tokens: string[]) => tokens.forEach((token) => classes.delete(token)),
        contains: (token: string) => classes.has(token),
      },
    };
  };

  it("reports page fullscreen from local UI state", () => {
    expect(isPageFullscreenActive(true)).toBe(true);
    expect(isPageFullscreenActive(false)).toBe(false);
  });

  it("locks page scrolling and marks fullscreen state while active", () => {
    const body = createMockElement("auto");
    const documentElement = createMockElement("scroll");
    const doc = { body, documentElement } as unknown as Document;

    expect(setPageFullscreenLock(doc, true)).toBe(true);
    expect(body.style.overflow).toBe("hidden");
    expect(documentElement.style.overflow).toBe("hidden");
    expect(body.classList.contains("workspace-page-fullscreen")).toBe(true);
    expect(documentElement.classList.contains("workspace-page-fullscreen")).toBe(true);
    expect(body.dataset.workspaceFullscreenBodyOverflow).toBe("auto");
    expect(body.dataset.workspaceFullscreenHtmlOverflow).toBe("scroll");
  });

  it("restores page scrolling when fullscreen closes", () => {
    const body = createMockElement("auto");
    const documentElement = createMockElement("scroll");
    const doc = { body, documentElement } as unknown as Document;

    setPageFullscreenLock(doc, true);
    expect(setPageFullscreenLock(doc, false)).toBe(false);
    expect(body.style.overflow).toBe("auto");
    expect(documentElement.style.overflow).toBe("scroll");
    expect(body.classList.contains("workspace-page-fullscreen")).toBe(false);
    expect(documentElement.classList.contains("workspace-page-fullscreen")).toBe(false);
    expect(body.dataset.workspaceFullscreenBodyOverflow).toBeUndefined();
    expect(body.dataset.workspaceFullscreenHtmlOverflow).toBeUndefined();
  });
});
