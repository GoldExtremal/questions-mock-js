const dom = {
  nav: document.querySelector("#side-nav"),
  search: document.querySelector("#search"),
  searchClear: document.querySelector("#search-clear"),
  searchNav: document.querySelector("#search-nav"),
  searchCount: document.querySelector("#search-count"),
  searchPrev: document.querySelector("#search-prev"),
  searchNext: document.querySelector("#search-next"),
  header: document.querySelector(".site-header"),
};

const SECTION_SELECTOR = ".section-card";
const DISCLOSURE_SELECTOR = ".question-item, .practice-item";
const SEARCH_DEBOUNCE_MS = 500;

const sectionLinks = new Map();
const searchTargets = [];
const searchableTextElements = [];
const codeBlocks = [];
const disclosureItems = [];
const sectionCards = [];
let searchDebounceTimer = null;
let pendingActiveSectionId = null;

const THIS_SECTION_TERMS_PATTERN =
  /(^|[^A-Za-z0-9_$])(Constructor\.prototype|User\.prototype|new User\(\)|obj\.show\(\)|this\.value|this|call|apply|bind|new|undefined|prototype|instanceof|obj|fn|show|User)(?=$|[^A-Za-z0-9_$])/gi;

const searchState = {
  query: "",
  matches: [],
  index: 0,
  currentHit: null,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function matchesSearch(text, query) {
  const normalizedText = text.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  return terms.every((term) => normalizedText.includes(term));
}

function getSearchTerms(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function highlightSearchTerms(text, terms) {
  if (!terms.length) return text;

  const pattern = new RegExp(
    `(${terms
      .slice()
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})`,
    "gi",
  );

  return text.replace(pattern, '<mark class="search-hit">$1</mark>');
}

function isThisSectionInlineText(element) {
  return Boolean(
    element.closest("#this") &&
      element.matches(".question-item__title, .question-note, .question-list li"),
  );
}

function highlightThisSectionTerms(text) {
  return escapeHtml(text).replace(
    THIS_SECTION_TERMS_PATTERN,
    '$1<code class="question-term">$2</code>',
  );
}

function decorateThisSectionTerms() {
  searchableTextElements.forEach((element) => {
    if (!isThisSectionInlineText(element)) return;

    element.innerHTML = highlightThisSectionTerms(element.dataset.baseText ?? "");
  });
}

function decorateThisSectionAnswerHeadings() {
  document
    .querySelectorAll("#this .answer-panel__heading, #this .answer-panel__subheading")
    .forEach((element) => {
      const baseText = element.dataset.baseText ?? element.textContent ?? "";

      element.dataset.baseText = baseText;
      element.innerHTML = highlightThisSectionTerms(baseText);
    });
}

function styleJsToken(token, terms = []) {
  const highlighted = highlightSearchTerms(escapeHtml(token), terms);

  if (token.startsWith("//") || token.startsWith("/*")) {
    return `<span class="token-comment">${highlighted}</span>`;
  }

  if (token.startsWith("'") || token.startsWith('"') || token.startsWith("`")) {
    return `<span class="token-string">${highlighted}</span>`;
  }

  if (/^\d/.test(token)) {
    return `<span class="token-number">${highlighted}</span>`;
  }

  if (
    [
      "const",
      "let",
      "var",
      "function",
      "return",
      "if",
      "else",
      "for",
      "while",
      "switch",
      "case",
      "break",
      "continue",
      "new",
      "class",
      "extends",
      "super",
      "this",
      "async",
      "await",
      "try",
      "catch",
      "finally",
      "throw",
      "import",
      "from",
      "export",
      "default",
      "of",
      "in",
      "instanceof",
      "typeof",
      "delete",
      "yield",
    ].includes(token)
  ) {
    return `<span class="token-keyword">${highlighted}</span>`;
  }

  if (
    [
      "Promise",
      "Object",
      "Array",
      "Map",
      "Set",
      "WeakMap",
      "WeakSet",
      "Date",
      "Math",
      "JSON",
      "RegExp",
      "Error",
      "Number",
      "String",
      "Boolean",
      "Symbol",
      "BigInt",
      "Function",
      "console",
      "document",
      "window",
      "globalThis",
      "navigator",
      "localStorage",
      "sessionStorage",
      "fetch",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "MutationObserver",
    ].includes(token)
  ) {
    return `<span class="token-builtins">${highlighted}</span>`;
  }

  if (token === "=>" || "{}()[]".includes(token) || ".,;:+-*/%!?=<>|&^~".includes(token)) {
    return `<span class="token-operator">${highlighted}</span>`;
  }

  return highlighted;
}

function highlightJs(code, terms = []) {
  const tokenPattern =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|=>|[{}()[\].,;:+\-*/%!?=<>|&^~]/g;
  let result = "";
  let lastIndex = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    result += escapeHtml(code.slice(lastIndex, index));
    result += styleJsToken(token, terms);
    lastIndex = index + token.length;
  }

  result += escapeHtml(code.slice(lastIndex));
  return result;
}

function highlightHtml(code, terms = []) {
  const tokenPattern =
    /<!--[\s\S]*?-->|<\/?[A-Za-z][\w:-]*|\/?>|\b[A-Za-z_:][\w:.-]*\b|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g;
  let result = "";
  let lastIndex = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    result += escapeHtml(code.slice(lastIndex, index));

    if (token.startsWith("<!--")) {
      result += `<span class="token-comment">${highlightSearchTerms(escapeHtml(token), terms)}</span>`;
    } else if (token.startsWith("<")) {
      result += `<span class="token-tag">${highlightSearchTerms(escapeHtml(token), terms)}</span>`;
    } else if (token.startsWith('"') || token.startsWith("'")) {
      result += `<span class="token-string">${highlightSearchTerms(escapeHtml(token), terms)}</span>`;
    } else if (token === "/>" || token === ">") {
      result += `<span class="token-operator">${highlightSearchTerms(escapeHtml(token), terms)}</span>`;
    } else {
      result += `<span class="token-attr">${highlightSearchTerms(escapeHtml(token), terms)}</span>`;
    }

    lastIndex = index + token.length;
  }

  result += escapeHtml(code.slice(lastIndex));
  return result;
}

function guessLanguage(code) {
  return code.trimStart().startsWith("<") ? "html" : "js";
}

function renderHighlightedCode(codeText, language, query = "") {
  const terms = getSearchTerms(query);
  return language === "html" ? highlightHtml(codeText, terms) : highlightJs(codeText, terms);
}

function getHeaderBottom() {
  return dom.header ? Math.ceil(dom.header.getBoundingClientRect().bottom) : 0;
}

function getScrollTopForElement(element) {
  if (!element) return window.scrollY;

  const anchor =
    element.classList?.contains("search-hit")
      ? element
      : element.querySelector?.(".search-hit") ||
        element.querySelector(".section-title") ||
        element.querySelector(".question-item__title") ||
        element.querySelector(".practice-item__title") ||
        element;

  return anchor.getBoundingClientRect().top + window.scrollY - getHeaderBottom();
}

function setToggleExpanded(container, selector, expanded) {
  const toggle = container?.querySelector(selector);
  if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
}

function setDisclosureOpen(container, selector, open) {
  if (!container) return;

  container.classList.toggle("is-open", open);
  setToggleExpanded(container, selector, open);
}

function collectSearchTargets() {
  searchTargets.length = 0;
  searchableTextElements.length = 0;
  codeBlocks.length = 0;

  document.querySelectorAll("[data-base-text]").forEach((element) => {
    if (element.closest(".answer-panel")) return;

    searchableTextElements.push(element);
    searchTargets.push({
      element,
      searchText: element.dataset.baseText ?? "",
      container: element.closest(".question-item, .practice-item, .section-card, .practice-card") ?? element,
    });
  });

  document.querySelectorAll("code[data-raw]").forEach((code) => {
    if (code.closest(".answer-panel")) return;

    codeBlocks.push(code);
    searchTargets.push({
      element: code,
      searchText: code.dataset.raw ?? "",
      container: code.closest(".question-item, .practice-item") ?? code,
    });
  });

  disclosureItems.length = 0;
  document.querySelectorAll(DISCLOSURE_SELECTOR).forEach((item) => {
    disclosureItems.push(item);
  });

  sectionCards.length = 0;
  document.querySelectorAll(SECTION_SELECTOR).forEach((section) => {
    sectionCards.push(section);
  });
}

function restoreSearchableText() {
  searchableTextElements.forEach((element) => {
    element.textContent = element.dataset.baseText ?? "";
  });

  decorateThisSectionTerms();
}

function highlightSearchableText(query) {
  restoreSearchableText();

  const terms = getSearchTerms(query);
  if (!terms.length) return;

  searchableTextElements.forEach((element) => {
    const baseText = element.dataset.baseText ?? "";
    if (!baseText) return;
    element.innerHTML = highlightSearchTerms(escapeHtml(baseText), terms);
  });
}

function updateCodeSearchHighlights(query) {
  const terms = getSearchTerms(query);
  codeBlocks.forEach((code) => {
    const raw = code.dataset.raw ?? "";
    const language = code.dataset.language ?? guessLanguage(raw);
    code.innerHTML = language === "html" ? highlightHtml(raw, terms) : highlightJs(raw, terms);
  });
}

function clearSearchResultState() {
  document.querySelectorAll(".is-search-match, .is-current-search-match, .is-search-open").forEach((element) => {
    element.classList.remove("is-search-match", "is-current-search-match", "is-search-open");
  });

  searchState.currentHit?.classList.remove("is-current-search-hit");
  searchState.currentHit = null;
}

function setCurrentSearchHit(hitElement) {
  if (searchState.currentHit === hitElement) return;

  searchState.currentHit?.classList.remove("is-current-search-hit");
  searchState.currentHit = hitElement ?? null;

  if (hitElement) {
    hitElement.classList.add("is-current-search-hit");
  }
}

function setSearchControlsEnabled(visible) {
  if (dom.searchClear) dom.searchClear.style.display = visible ? "inline-flex" : "none";
  if (dom.searchNav) dom.searchNav.classList.toggle("is-visible", visible);
}

function updateSearchNavigationButtons() {
  const hasQuery = Boolean(searchState.query);
  const total = searchState.matches.length;

  if (dom.searchPrev) dom.searchPrev.disabled = !hasQuery || !total;
  if (dom.searchNext) dom.searchNext.disabled = !hasQuery || !total;
}

function updateSearchCounter() {
  if (!dom.searchCount) return;

  if (!searchState.query) {
    dom.searchCount.textContent = "0 из 0";
    return;
  }

  const total = searchState.matches.length;
  dom.searchCount.textContent = total ? `${searchState.index + 1} из ${total}` : "0 из 0";
}

function scrollToElement(element) {
  if (!element) return;

  const top = getScrollTopForElement(element);
  window.scrollTo({ top, behavior: "smooth" });
}

function focusSearchMatch(index, { scroll = true } = {}) {
  const match = searchState.matches[index];
  if (!match) return;

  searchState.index = index;

  document.querySelectorAll(".is-current-search-match").forEach((element) => {
    element.classList.remove("is-current-search-match");
  });

  if (match.container) {
    match.container.classList.add("is-current-search-match");
  }

  setCurrentSearchHit(match.hit);

  if (scroll) {
    scrollToElement(match.hit);
  }

  updateSearchNavigationButtons();
  updateSearchCounter();
}

function getSearchMatches(query) {
  if (!query) return [];
  return searchTargets.filter(({ searchText }) => matchesSearch(searchText, query));
}

function goToSearchMatch(direction) {
  if (!searchState.matches.length) return;

  const nextIndex = (searchState.index + direction + searchState.matches.length) % searchState.matches.length;
  focusSearchMatch(nextIndex, { scroll: true });
}

function scheduleSearch(query, delay = SEARCH_DEBOUNCE_MS) {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    applySearch(query);
  }, delay);
}

function applySearch(query) {
  const normalized = query.trim();
  searchState.query = normalized;
  searchState.index = 0;

  clearSearchResultState();
  highlightSearchableText(normalized);
  updateCodeSearchHighlights(normalized);

  searchState.matches = normalized
    ? Array.from(document.querySelectorAll(".search-hit")).map((hit) => ({
        hit,
        container: hit.closest(".question-item, .practice-item") ?? null,
      }))
    : [];

  const matchingTargets = getSearchMatches(normalized);
  const matchingContainers = new Set(
    matchingTargets.map(({ container }) => container).filter(Boolean),
  );

  searchTargets.forEach(({ element, searchText }) => {
    const isMatch = Boolean(normalized) && matchesSearch(searchText ?? "", normalized);
    element.classList.toggle("is-search-match", isMatch);
  });

  disclosureItems.forEach((container) => {
    const shouldOpen = matchingContainers.has(container);
    container.classList.toggle("is-search-open", shouldOpen);

    if (shouldOpen) {
      container.dataset.searchAutoOpen = "true";
      setDisclosureOpen(
        container,
        container.classList.contains("question-item")
          ? ".question-item__toggle"
          : ".practice-item__toggle",
        true,
      );
      return;
    }

    if (container.dataset.searchAutoOpen === "true") {
      delete container.dataset.searchAutoOpen;
      setDisclosureOpen(
        container,
        container.classList.contains("question-item")
          ? ".question-item__toggle"
          : ".practice-item__toggle",
        false,
      );
    }
  });

  if (searchState.matches.length) {
    focusSearchMatch(0, { scroll: Boolean(normalized) });
  }

  setSearchControlsEnabled(Boolean(normalized));
  updateSearchNavigationButtons();
  updateSearchCounter();
  updateActiveSection();
}

function collectSectionLinks() {
  sectionLinks.clear();
  dom.nav?.querySelectorAll("a[data-section-id]").forEach((link) => {
    sectionLinks.set(link.dataset.sectionId, link);
  });
}

function setActiveSection(sectionId) {
  sectionLinks.forEach((link, id) => {
    const isActive = id === sectionId;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-current", isActive ? "true" : "false");
  });
}

function scrollToSection(sectionId) {
  const target = document.getElementById(sectionId);
  if (!target) return;

  const top = target.getBoundingClientRect().top + window.scrollY - getHeaderBottom();

  window.scrollTo({ top, behavior: "smooth" });
  history.pushState(null, "", `#${sectionId}`);
}

function updateActiveSection() {
  const headerOffset = getHeaderBottom();
  const visibleSections = sectionCards
    .filter((element) => element && !element.classList.contains("is-hidden"))
    .map((element) => ({
      id: element.id,
      element,
    }));

  if (pendingActiveSectionId) {
    const pendingTarget = document.getElementById(pendingActiveSectionId);
    if (pendingTarget) {
      const rect = pendingTarget.getBoundingClientRect();
      if (rect.top <= headerOffset + 8 && rect.bottom > headerOffset) {
        pendingActiveSectionId = null;
      } else {
        setActiveSection(pendingActiveSectionId);
        return;
      }
    } else {
      pendingActiveSectionId = null;
    }
  }

  if (!visibleSections.length) {
    return;
  }

  let currentId = visibleSections[0].id;
  let nearestDistance = Number.POSITIVE_INFINITY;

  visibleSections.forEach(({ id, element }) => {
    const rect = element.getBoundingClientRect();
    const distance = Math.abs(rect.top - headerOffset);

    if (rect.top <= headerOffset + 8 && rect.bottom > headerOffset) {
      currentId = id;
      nearestDistance = 0;
      return;
    }

    if (rect.top > headerOffset && distance < nearestDistance) {
      currentId = id;
      nearestDistance = distance;
    }
  });

  setActiveSection(currentId);
}

function initCopyButtons() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-btn");
    if (!button) return;

    const code = button.closest(".code-shell")?.querySelector("code");
    const raw = code?.dataset.raw ?? "";
    if (!raw) return;

    const resetButton = () => {
      button.classList.remove("is-copied");
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(raw);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = raw;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }

      button.classList.add("is-copied");
      window.setTimeout(resetButton, 1400);
    } catch {
      resetButton();
    }
  });
}

function initAnswerButtons() {
  document.addEventListener("click", (event) => {
    const openButton = event.target.closest(".answer-toggle");
    const closeButton = event.target.closest(".answer-panel__close");
    if (!openButton && !closeButton) return;

    const section = (openButton || closeButton)?.closest(".answer-section");
    const panel = section?.querySelector(".answer-panel");
    if (!section || !panel) return;

    if (openButton) {
      openButton.hidden = true;
      openButton.setAttribute("aria-expanded", "true");
      panel.hidden = false;
      section.classList.add("is-open");
      return;
    }

    const toggle = section.querySelector(".answer-toggle");
    if (toggle) {
      toggle.hidden = false;
      toggle.setAttribute("aria-expanded", "false");
    }
    panel.hidden = true;
    section.classList.remove("is-open");
  });
}

function initQuestionToggles() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".question-item__toggle");
    if (toggle) {
      const item = toggle.closest(".question-item");
      const isOpen = !item.classList.contains("is-open");
      setDisclosureOpen(item, ".question-item__toggle", isOpen);
      return;
    }

    const practiceToggle = event.target.closest(".practice-item__toggle");
    if (practiceToggle) {
      const item = practiceToggle.closest(".practice-item");
      const isOpen = !item.classList.contains("is-open");
      setDisclosureOpen(item, ".practice-item__toggle", isOpen);
    }
  });
}

function initNavigation() {
  dom.nav?.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-section-id]");
    if (!link) return;

    event.preventDefault();
    pendingActiveSectionId = link.dataset.sectionId;
    setActiveSection(link.dataset.sectionId);
    scrollToSection(link.dataset.sectionId);
  });
}

function initSearch() {
  dom.search?.addEventListener("input", (event) => {
    scheduleSearch(event.target.value, SEARCH_DEBOUNCE_MS);
  });

  dom.search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      window.clearTimeout(searchDebounceTimer);
      applySearch(event.target.value);
      goToSearchMatch(1);
    }
  });

  dom.searchClear?.addEventListener("click", () => {
    window.clearTimeout(searchDebounceTimer);
    dom.search.value = "";
    applySearch("");
    dom.search.focus();
  });

  dom.searchPrev?.addEventListener("click", () => {
    goToSearchMatch(-1);
  });

  dom.searchNext?.addEventListener("click", () => {
    goToSearchMatch(1);
  });
}

let scrollTicking = false;

function onScrollOrResize() {
  if (scrollTicking) return;

  scrollTicking = true;
  window.requestAnimationFrame(() => {
    updateActiveSection();
    scrollTicking = false;
  });
}

function init() {
  collectSectionLinks();
  collectSearchTargets();

  searchableTextElements.forEach((element) => {
    element.dataset.baseText = element.dataset.baseText ?? element.textContent ?? "";
  });

  codeBlocks.forEach((code) => {
    const raw = code.dataset.raw ?? "";
    const language = code.dataset.language ?? guessLanguage(raw);
    code.innerHTML = renderHighlightedCode(raw, language);
  });

  initCopyButtons();
  initAnswerButtons();
  initQuestionToggles();
  initNavigation();
  initSearch();
  decorateThisSectionAnswerHeadings();

  applySearch("");
  updateActiveSection();

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);
}

init();
