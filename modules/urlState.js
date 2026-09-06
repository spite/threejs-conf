import { effect } from "reactive";

function coerceParam(raw, fallback) {
  if (Array.isArray(fallback)) {
    const parts = raw.split(",").map(Number);
    if (parts.length !== fallback.length) return undefined;
    return parts.some((v) => !Number.isFinite(v)) ? undefined : parts;
  }
  if (typeof fallback === "number") {
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof fallback === "boolean") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return undefined;
  }
  if (typeof fallback === "string") return raw;
  return undefined;
}

function readQueryString(text, defaults) {
  const out = {};
  if (!text) return out;
  for (const [key, raw] of new URLSearchParams(text)) {
    if (!(key in defaults)) continue;
    const value = coerceParam(raw, defaults[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function readHash(defaults) {
  return readQueryString(location.hash.replace(/^#/, ""), defaults);
}

function readUrlOverrides(defaults) {
  return {
    ...readQueryString(location.search.replace(/^\?/, ""), defaults),
    ...readHash(defaults),
  };
}

function syncHash(params, defaults, onApply, delay = 250) {
  let written = location.hash;
  let timer = null;

  const stateHash = () => {
    const query = params.$toQuery();
    return query ? `#${query}` : "";
  };

  const write = () => {
    clearTimeout(timer);
    timer = null;
    const next = stateHash();
    if (next === location.hash) return;
    written = next;
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}${next}`,
    );
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(write, delay);
  };

  for (const key of params.$persisted) {
    effect(() => {
      params[key].target();
      schedule();
    });
  }

  const onHashChange = () => {
    if (location.hash === written) return;
    written = location.hash;
    params.$apply({ ...defaults, ...readHash(defaults) });
    if (onApply) onApply();
  };

  addEventListener("hashchange", onHashChange);
  addEventListener("pagehide", write);

  return { write, stateHash };
}

export { readUrlOverrides, syncHash };
