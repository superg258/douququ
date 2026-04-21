const FULLSCREEN_CLASS = "workspace-page-fullscreen";
const BODY_OVERFLOW_KEY = "workspaceFullscreenBodyOverflow";
const HTML_OVERFLOW_KEY = "workspaceFullscreenHtmlOverflow";

type FullscreenHost = {
  body: {
    style: { overflow: string };
    dataset: Record<string, string | undefined>;
    classList: { add: (...tokens: string[]) => void; remove: (...tokens: string[]) => void };
  };
  documentElement: {
    style: { overflow: string };
    classList: { add: (...tokens: string[]) => void; remove: (...tokens: string[]) => void };
  };
};

export function isPageFullscreenActive(fullscreen: boolean) {
  return fullscreen;
}

export function setPageFullscreenLock(doc: FullscreenHost, active: boolean) {
  const { body, documentElement } = doc;

  if (active) {
    if (body.dataset[BODY_OVERFLOW_KEY] === undefined) {
      body.dataset[BODY_OVERFLOW_KEY] = body.style.overflow;
    }
    if (body.dataset[HTML_OVERFLOW_KEY] === undefined) {
      body.dataset[HTML_OVERFLOW_KEY] = documentElement.style.overflow;
    }

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    body.classList.add(FULLSCREEN_CLASS);
    documentElement.classList.add(FULLSCREEN_CLASS);
    return true;
  }

  body.style.overflow = body.dataset[BODY_OVERFLOW_KEY] ?? "";
  documentElement.style.overflow = body.dataset[HTML_OVERFLOW_KEY] ?? "";
  delete body.dataset[BODY_OVERFLOW_KEY];
  delete body.dataset[HTML_OVERFLOW_KEY];
  body.classList.remove(FULLSCREEN_CLASS);
  documentElement.classList.remove(FULLSCREEN_CLASS);
  return false;
}
