// Banner ve video açıklamasında sadece güvenli HTML etiketlerine izin ver.
export function sanitizeRichText(raw) {
  const div = document.createElement("div");
  div.innerHTML = raw;

  const ALLOWED_TAGS = new Set(["A", "STRONG", "B", "EM", "U", "#text", "BR"]);
  const ALLOWED_ATTRS = { A: new Set(["href", "target"]) };

  function clean(node) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (!ALLOWED_TAGS.has(child.nodeName)) {
        child.replaceWith(document.createTextNode(child.textContent));
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const allowed = ALLOWED_ATTRS[child.tagName] || new Set();
        for (const attr of Array.from(child.attributes)) {
          if (!allowed.has(attr.name)) child.removeAttribute(attr.name);
        }
        if (child.tagName === "A") {
          const href = (child.getAttribute("href") || "").trim().toLowerCase();
          if (href.startsWith("javascript:") || href.startsWith("data:")) {
            child.removeAttribute("href");
          }
        }
        clean(child);
      }
    }
  }
  clean(div);
  return div.innerHTML;
}
