const nav = document.querySelector("#side-nav");
const search = document.querySelector("#search");
const searchClear = document.querySelector("#search-clear");
const searchNav = document.querySelector("#search-nav");
const searchCount = document.querySelector("#search-count");
const searchPrev = document.querySelector("#search-prev");
const searchNext = document.querySelector("#search-next");

const sectionLinks = new Map();
const searchTargets = [];
const searchableTextElements = [];
let searchDebounceTimer = null;
let pendingActiveSectionId = null;

const searchState = {
  query: "",
  matches: [],
  index: 0,
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

function collectSearchTargets() {
  searchTargets.length = 0;
  searchableTextElements.length = 0;

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
    searchTargets.push({
      element: code,
      searchText: code.dataset.raw ?? "",
      container: code.closest(".question-item, .practice-item") ?? code,
    });
  });
}

function restoreSearchableText() {
  searchableTextElements.forEach((element) => {
    element.textContent = element.dataset.baseText ?? "";
  });
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
  document.querySelectorAll("code[data-raw]").forEach((code) => {
    const raw = code.dataset.raw ?? "";
    const language = code.dataset.language ?? guessLanguage(raw);
    code.innerHTML = language === "html" ? highlightHtml(raw, terms) : highlightJs(raw, terms);
  });
}

function clearSearchResultState() {
  document.querySelectorAll(".is-search-match, .is-current-search-match, .is-search-open").forEach((element) => {
    element.classList.remove("is-search-match", "is-current-search-match", "is-search-open");
  });

  document.querySelectorAll(".is-current-search-hit").forEach((element) => {
    element.classList.remove("is-current-search-hit");
  });
}

function setCurrentSearchHit(hitElement) {
  document.querySelectorAll(".is-current-search-hit").forEach((element) => {
    element.classList.remove("is-current-search-hit");
  });

  if (hitElement) {
    hitElement.classList.add("is-current-search-hit");
  }
}

function setSearchControlsEnabled(visible) {
  if (searchClear) searchClear.style.display = visible ? "inline-flex" : "none";
  if (searchNav) searchNav.classList.toggle("is-visible", visible);
}

function updateSearchNavigationButtons() {
  const hasQuery = Boolean(searchState.query);
  const total = searchState.matches.length;

  if (searchPrev) searchPrev.disabled = !hasQuery || !total;
  if (searchNext) searchNext.disabled = !hasQuery || !total;
}

function updateSearchCounter() {
  if (!searchCount) return;

  if (!searchState.query) {
    searchCount.textContent = "0 из 0";
    return;
  }

  const total = searchState.matches.length;
  searchCount.textContent = total ? `${searchState.index + 1} из ${total}` : "0 из 0";
}

function scrollToElement(element) {
  if (!element) return;

  const anchor =
    element.classList?.contains("search-hit")
      ? element
      : element.querySelector?.(".search-hit") ||
        element.querySelector(".section-title") ||
        element.querySelector(".question-item__title") ||
        element.querySelector(".practice-item__title") ||
        element;

  const header = document.querySelector(".site-header");
  const headerBottom = header ? Math.ceil(header.getBoundingClientRect().bottom) : 0;
  const top = anchor.getBoundingClientRect().top + window.scrollY - headerBottom + 1;

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

function scheduleSearch(query, delay = 500) {
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

  searchTargets.forEach(({ element, searchText }) => {
    const isMatch = Boolean(normalized) && matchesSearch(searchText ?? "", normalized);
    element.classList.toggle("is-search-match", isMatch);
  });

  document.querySelectorAll(".question-item, .practice-item").forEach((container) => {
    const shouldOpen = matchingTargets.some(({ container: matchedContainer }) => matchedContainer === container);
    container.classList.toggle("is-search-open", shouldOpen);

    const toggle = container.querySelector(".question-item__toggle, .practice-item__toggle");
    if (shouldOpen) {
      container.classList.add("is-open");
      container.dataset.searchAutoOpen = "true";
      if (toggle) toggle.setAttribute("aria-expanded", "true");
      return;
    }

    if (container.dataset.searchAutoOpen === "true") {
      container.classList.remove("is-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
      delete container.dataset.searchAutoOpen;
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
  nav?.querySelectorAll("a[data-section-id]").forEach((link) => {
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

  const header = document.querySelector(".site-header");
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const targetTop = target.getBoundingClientRect().top + window.scrollY;
  const top = targetTop - headerBottom;

  window.scrollTo({ top, behavior: "smooth" });
  history.pushState(null, "", `#${sectionId}`);
}

function updateActiveSection() {
  const headerOffset = 92;
  const visibleSections = [
    ...document.querySelectorAll(".section-card"),
    document.getElementById("practice"),
  ]
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
      const isOpen = item.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      return;
    }

    const practiceToggle = event.target.closest(".practice-item__toggle");
    if (practiceToggle) {
      const item = practiceToggle.closest(".practice-item");
      const isOpen = item.classList.toggle("is-open");
      practiceToggle.setAttribute("aria-expanded", String(isOpen));
    }
  });
}

function initNavigation() {
  nav?.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-section-id]");
    if (!link) return;

    event.preventDefault();
    pendingActiveSectionId = link.dataset.sectionId;
    setActiveSection(link.dataset.sectionId);
    scrollToSection(link.dataset.sectionId);
  });
}

function initSearch() {
  search?.addEventListener("input", (event) => {
    scheduleSearch(event.target.value);
  });

  search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      window.clearTimeout(searchDebounceTimer);
      applySearch(event.target.value);
      goToSearchMatch(1);
    }
  });

  searchClear?.addEventListener("click", () => {
    window.clearTimeout(searchDebounceTimer);
    search.value = "";
    applySearch("");
    search.focus();
  });

  searchPrev?.addEventListener("click", () => {
    goToSearchMatch(-1);
  });

  searchNext?.addEventListener("click", () => {
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

  document.querySelectorAll("code[data-raw]").forEach((code) => {
    const raw = code.dataset.raw ?? "";
    const language = code.dataset.language ?? guessLanguage(raw);
    code.innerHTML = renderHighlightedCode(raw, language);
  });

  initCopyButtons();
  initAnswerButtons();
  initQuestionToggles();
  initNavigation();
  initSearch();

  applySearch("");
  updateActiveSection();

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);
}

init();
