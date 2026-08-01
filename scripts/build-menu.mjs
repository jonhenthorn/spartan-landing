import { readFile, writeFile } from "node:fs/promises";

const menu = JSON.parse(await readFile(new URL("../data/menu.json", import.meta.url), "utf8"));
const indexPath = new URL("../index.html", import.meta.url);
const startMarker = "<!-- MENU_DATA_START -->";
const endMarker = "<!-- MENU_DATA_END -->";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const sections = menu.sections.map((section) => {
  const groups = section.groups.map((group) => `
        <div class="menu-group">
          <h4>${escapeHtml(group.label)}</h4>
          <ul class="flavor-list">
            ${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n            ")}
          </ul>
        </div>`).join("");

  return `
      <article class="menu-panel" id="${escapeHtml(section.id)}">
        <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
        <h3>${escapeHtml(section.title)}</h3>
        <p>${escapeHtml(section.description)}</p>${groups}
      </article>`;
}).join("");

const generated = `${startMarker}
    <div class="menu-grid">${sections}
    </div>
    <p class="menu-note">${escapeHtml(menu.note)}</p>
    ${endMarker}`;

const source = await readFile(indexPath, "utf8");
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);

if (start === -1 || end === -1 || end < start) {
  throw new Error("Menu markers were not found in index.html");
}

const next = `${source.slice(0, start)}${generated}${source.slice(end + endMarker.length)}`;
await writeFile(indexPath, next);
console.log(`Updated index.html from data/menu.json (${menu.sections.length} menu sections).`);
