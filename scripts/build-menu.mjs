import { readFile, writeFile } from "node:fs/promises";

const menu = JSON.parse(await readFile(new URL("../data/menu.json", import.meta.url), "utf8"));
const megaTeaKits = JSON.parse(await readFile(new URL("../data/mega-tea-kits.json", import.meta.url), "utf8"));
const indexPath = new URL("../index.html", import.meta.url);
const menuPagePath = new URL("../menu/index.html", import.meta.url);
const specialMenuStartMarker = "<!-- SPECIAL_MENU_DATA_START -->";
const specialMenuEndMarker = "<!-- SPECIAL_MENU_DATA_END -->";
const menuStartMarker = "<!-- MENU_DATA_START -->";
const menuEndMarker = "<!-- MENU_DATA_END -->";
const megaTeaKitsStartMarker = "<!-- MEGA_TEA_KITS_DATA_START -->";
const megaTeaKitsEndMarker = "<!-- MEGA_TEA_KITS_DATA_END -->";

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatCurrency = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: megaTeaKits.currency
}).format(value);

const replaceMarkedSection = (source, startMarker, endMarker, generated) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Generated-content markers were not found: ${startMarker} / ${endMarker}`);
  }

  return `${source.slice(0, start)}${generated}${source.slice(end + endMarker.length)}`;
};

const renderSpecialMenu = ({ assetPrefix = "", menuHref }) => {
  const special = menu.specialMenu;
  if (!special) throw new Error("data/menu.json is missing specialMenu");

  return `${specialMenuStartMarker}
      <span class="anchor-alias" id="current-release" aria-hidden="true"></span>
      <section class="section section-sea" id="special-menu">
        <div class="container release-grid">
          <div class="release-frame">
            <span class="release-badge">Special menu</span>
            <img
              src="${escapeHtml(`${assetPrefix}${special.image}`)}"
              width="${escapeHtml(special.imageWidth)}"
              height="${escapeHtml(special.imageHeight)}"
              alt="${escapeHtml(special.imageAlt)}"
              loading="lazy"
            />
          </div>
          <div class="release-copy">
            <p class="eyebrow">${escapeHtml(special.eyebrow)}</p>
            <h2>${escapeHtml(special.title)}</h2>
            <p>${escapeHtml(special.description)}</p>
            <p>${escapeHtml(special.continuityNote)}</p>
            <div class="inline-actions">
              <a class="button button-secondary" href="tel:+19189289755" data-track="call_click" data-track-location="special_menu">Call about a recipe</a>
              <a class="button button-ghost" href="${escapeHtml(menuHref)}" data-track="menu_click" data-track-location="special_menu">Explore our menu</a>
            </div>
          </div>
        </div>
      </section>
      ${specialMenuEndMarker}`;
};

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

const generatedMenu = `${menuStartMarker}
    <div class="menu-grid">${sections}
    </div>
    <p class="menu-note">${escapeHtml(menu.note)}</p>
    ${menuEndMarker}`;

const selectionCount = megaTeaKits.selectionGroups.reduce(
  (total, group) => total + group.items.length,
  0
);

const megaTeaKitGroups = megaTeaKits.selectionGroups.map((group) => `
            <details class="mega-kit-group" data-mega-kit-group="${escapeHtml(group.id)}">
              <summary>
                <span class="mega-kit-group-title">${escapeHtml(group.label)}</span>
                <span class="mega-kit-count">${group.items.length} choices</span>
              </summary>
              <p>${escapeHtml(group.description)}</p>
              <ul class="mega-kit-list">
                ${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n                ")}
              </ul>
            </details>`).join("");

const liftoffGroup = `
            <details class="mega-kit-group" data-mega-kit-group="optional-liftoff-flavors">
              <summary>
                <span class="mega-kit-group-title">Optional Liftoff flavors</span>
                <span class="mega-kit-count">${megaTeaKits.optionalLiftoffFlavors.length} choices</span>
              </summary>
              <p>Choose up to one included Liftoff flavor, or leave it out.</p>
              <ul class="mega-kit-list">
                ${megaTeaKits.optionalLiftoffFlavors.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n                ")}
              </ul>
            </details>`;

const addInsGroup = `
            <details class="mega-kit-group" data-mega-kit-group="paid-add-ins">
              <summary>
                <span class="mega-kit-group-title">Optional paid add-ins</span>
                <span class="mega-kit-count">${megaTeaKits.paidAddIns.length} choices</span>
              </summary>
              <p>Add one or more available packets to customize your kit. Each listed price is added to the base kit price.</p>
              <ul class="mega-kit-list mega-kit-priced-list">
                ${megaTeaKits.paidAddIns.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>+${escapeHtml(formatCurrency(item.price))}</strong></li>`).join("\n                ")}
              </ul>
            </details>`;

const generatedMegaTeaKits = `${megaTeaKitsStartMarker}
      <section class="section mega-kits" id="mega-tea-kits" aria-labelledby="mega-tea-kits-title" data-track-view="mega_tea_kits_view">
        <div class="container mega-kits-shell">
          <div class="mega-kits-intro">
            <div>
              <p class="eyebrow">${escapeHtml(megaTeaKits.eyebrow)}</p>
              <h2 id="mega-tea-kits-title">${escapeHtml(megaTeaKits.title)}</h2>
              <p>${escapeHtml(megaTeaKits.description)}</p>
            </div>
            <div class="mega-kit-price" aria-label="Base kit price ${escapeHtml(formatCurrency(megaTeaKits.basePrice))}">
              <span>Base kit</span>
              <strong>${escapeHtml(formatCurrency(megaTeaKits.basePrice))}</strong>
            </div>
          </div>

          <div class="mega-kit-includes" aria-label="What every Mega Tea Kit includes">
            <p><strong>Every kit includes:</strong> ${megaTeaKits.fixedBase.map(escapeHtml).join(" + ")}.</p>
            <p>Then choose exactly one of ${selectionCount} build-your-own or named-tea options.</p>
          </div>

          <div class="mega-kit-groups">${megaTeaKitGroups}${liftoffGroup}${addInsGroup}
          </div>

          <div class="mega-kit-order">
            <div>
              <h3>Choose your kit, then pick it up at Spartan.</h3>
              <p>${escapeHtml(megaTeaKits.availabilityNote)}</p>
            </div>
            <div class="inline-actions">
              <a class="button button-primary" href="${escapeHtml(megaTeaKits.orderUrl)}" target="_blank" rel="noopener noreferrer" data-track="mega_tea_kit_order_click">Order online for pickup</a>
              <a class="button button-ghost" href="tel:+19189289755" data-track="mega_tea_kit_call_click">Call about a kit</a>
            </div>
          </div>
        </div>
      </section>
      ${megaTeaKitsEndMarker}`;

const source = await readFile(indexPath, "utf8");
const withSpecialMenu = replaceMarkedSection(
  source,
  specialMenuStartMarker,
  specialMenuEndMarker,
  renderSpecialMenu({ menuHref: "/menu/#our-menu" })
);
const withMenu = replaceMarkedSection(withSpecialMenu, menuStartMarker, menuEndMarker, generatedMenu);
const next = replaceMarkedSection(
  withMenu,
  megaTeaKitsStartMarker,
  megaTeaKitsEndMarker,
  generatedMegaTeaKits
);
await writeFile(indexPath, next);

const menuPageSource = await readFile(menuPagePath, "utf8");
const menuPageWithSpecialMenu = replaceMarkedSection(
  menuPageSource,
  specialMenuStartMarker,
  specialMenuEndMarker,
  renderSpecialMenu({ assetPrefix: "../", menuHref: "#our-menu" })
);
const nextMenuPage = replaceMarkedSection(
  menuPageWithSpecialMenu,
  menuStartMarker,
  menuEndMarker,
  generatedMenu
);
await writeFile(menuPagePath, nextMenuPage);
console.log(
  `Updated index.html and menu/index.html from data/menu.json (${menu.sections.length} menu sections) and data/mega-tea-kits.json (${selectionCount} kit selections).`
);
