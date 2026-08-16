# Spartan Nutrition website

This repository contains the static website published at [spartandrink.com](https://spartandrink.com/). GitHub Pages serves the files from the `main` branch and Cloudflare manages the public domain, HTTPS and redirects.

## Phase 1 structure

- `index.html` — primary landing page and canonical homepage.
- `menu/index.html` — crawlable page for our menu, special menus and most popular recipes, generated from the same structured source as the homepage.
- `products-at-home/index.html` — shipped-product, independent-reordering and optional member-savings journey.
- `assets/site.css` and `assets/site.js` — shared presentation and interactions.
- `data/menu.json` — structured special-menu feature and full menu source.
- `data/mega-tea-kits.json` — structured source for To-Go Tea and Mega Tea Kit choices, optional Liftoff flavors, add-ins and prices.
- `assets/current-release-menu.webp` — the replaceable featured special-menu image.
- `privacy.html` — website and subscriber privacy disclosures.
- `offer-terms.html` — first-drink offer rules.
- `apps-script/` — source and deployment instructions for the Google Sheet form handler.
- `worker/` — the dependency-free Cloudflare Worker that confirms Sheet-backed form results on the Spartan page.
- `docs/SEO-SOCIAL-PLAYBOOK.md` — the owner routine for local search, social links and campaign attribution.
- `docs/MARKETING-ENGAGEMENT-ROADMAP.md` — the staged plan for confirmation UX, subscriber interests, acquisition-source learning, referrals, reviews, gamification and social automation.
- `docs/MARKETING-MEASUREMENT-DICTIONARY.md` — canonical customer milestones, source-of-truth boundaries, KPI formulas, cohorts, alerts and staged data architecture for the marketing portfolio.
- `docs/EXTERNAL-CONFIGURATION.md` — dated, non-secret evidence of the current Cloudflare, Google and social-link configuration.
- `spartan-landing/index.html` and `index_updated.html` — noindex browser fallbacks retained behind the active Cloudflare redirects.

## Routine owner updates

### Replace the featured special menu

1. Export the new menu as a clear portrait JPG, PNG or WebP image.
2. Convert and resize it to WebP before uploading. From the repository folder on a Mac with `cwebp` installed:

   ```sh
   cwebp -q 82 -resize 1200 0 "/path/to/new-menu.jpg" -o assets/current-release-menu.webp
   ```

3. Update the `specialMenu` title, description, continuity note, dimensions and image alt text in `data/menu.json`.
4. Run `node scripts/build-menu.mjs` to refresh both the homepage and `/menu/` page.
5. Preview both pages on phone and desktop before publishing.

Replacing the file with the same name changes which special-menu artwork is featured. Recipes from earlier special menus remain available and should not be described as expired or discontinued.

### Update our menu

1. Edit `data/menu.json`.
2. Generate the matching accessible HTML:

   ```sh
   node scripts/build-menu.mjs
   ```

3. Review `index.html` and `menu/index.html`, then preview both pages.

The same build step refreshes the featured special menu and our menu on both public pages, plus the homepage Mega Tea Kit section from its separate data file.

### Update To-Go Teas and Mega Tea Kits

Use the current live Square Ordering Profile as the source of truth before changing either take-home option or its price.

1. Edit `data/mega-tea-kits.json` rather than editing the generated kit lists in `index.html`.
2. Keep the three main selection groups separate: build-your-own flavors, Spartan favorites and special-menu recipes.
3. Update the To-Go Tea base choices, optional Liftoff price, Mega Tea Kit Liftoff list, paid add-ins, prices and `lastReviewed` date only when the live Square setup changes.
4. Generate the accessible website section:

   ```sh
   node scripts/build-menu.mjs
   ```

5. Run `node scripts/validate-site.mjs`. The validator confirms the $5 To-Go Tea configuration, 51 build-your-own flavors, 15 Spartan favorites, 46 additional named recipes, 8 optional Liftoff flavors and 30 paid add-ins, checks for duplicate entries, and confirms that every data-file choice appears on the page.
6. Preview the collapsed and expanded lists on both phone and desktop. Confirm the online-pickup button reaches the current Spartan ordering profile before publishing.

The website includes current catalog choices for discovery, but availability can change. Keep the visible availability note and avoid promising inventory that has not been verified in Square.

### Update hours or contact information

Update both the visible `visit` section and the `LocalBusiness` JSON-LD block near the top of `index.html`. Keeping them aligned prevents customers and search engines from seeing different hours.

### Validate before publishing

Run the dependency-free validation script after changing content, forms, menu data, links or business information:

```sh
node scripts/validate-site.mjs
```

It checks local page and asset references, anchor targets, structured data, JavaScript syntax, our-menu and Mega Tea Kit data/rendering parity, Google Sheet headers, coupon behavior and email-consent behavior. It does not replace visual browser testing, live Square availability checks or a real Apps Script deployment test.

### Preview before publishing

From the repository folder, start a local preview:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`, `http://127.0.0.1:4173/menu/` and `http://127.0.0.1:4173/products-at-home/`. Preview mode on every non-production hostname prevents coupon and email forms from submitting and does not load the production Google tag or Meta Pixel. Stop the preview with `Control-C` when finished.

The stylesheet and browser script use a date-based `?v=` value in page references so GitHub Pages and Cloudflare visitors receive a new file after a release. Update that value on every page that references `assets/site.css` or `assets/site.js` whenever either file changes.

## Form deployment gate

The primary form path is a same-origin `POST /api/forms` request through a small Cloudflare Worker. The Worker signs and forwards only approved form fields to Apps Script, and the Spartan page reveals the coupon only after an authenticated response confirms the Sheet-backed result. This removes the normal Google “Saved” page from the customer journey without reverting to an unverified `no-cors` success state.

The native Apps Script POST-and-redirect remains as a visible recovery option if the Worker or network is unavailable. The transitional Apps Script also accepts legacy GET coupon claims from cached copies of the old page. Follow the staged deployment and rollback procedure in [`apps-script/README.md`](apps-script/README.md) and [`worker/README.md`](worker/README.md). During rollout, the browser accepts native returns from handler v3.1 or v3.2, while Worker JSON results must match v3.2 and the exact Worker contract.

Coupon claims do not create marketing permission unless the visitor separately selects the optional, unchecked email-updates box. The dedicated email signup remains available for visitors who do not claim the offer. SMS signup is not included in Phase 1.

## Approved staged deployment checklist

1. Confirm the featured special-menu image and accompanying drink names are accurate.
2. Confirm hours, phone, email, address and social links.
3. Run the local validators and complete the owner preview; publish the approved compatibility frontend to GitHub before changing the form handler.
4. Add the shared secret and publish Apps Script v3.2 at the existing `/exec` URL; verify health and the intended Sheet before routing traffic through it.
5. Deploy the Worker route and secrets, then verify `/api/forms/health`. Apply a conservative form-endpoint rate limit and monitor provider quotas.
6. Confirm the email-signup consent columns appear in Google Sheets.
7. Test coupon claim, email signup, modal keyboard behavior, calls and directions through production.
8. Confirm Meta receives `PageView` and a single `Lead` only after a successful coupon return, with automatic advanced matching/form collection reviewed against the privacy promise.
9. Confirm GA4 receives page views and approved anonymous events without names, email addresses or phone numbers.
10. Confirm a newly granted email opt-in reaches the approved Brevo list while an unchecked coupon does not.
11. Review the privacy and offer terms against the final provider configuration.
12. Verify the active Cloudflare rules still force HTTPS, redirect `/index.html` to `/`, redirect legacy pages to `/`, preserve query strings and avoid redirect chains.

No customer data, API keys, spreadsheet IDs or provider credentials should be committed to this repository.

## Phase 1 data and measurement boundaries

- **Google Sheet:** source of website coupon claims and auditable email permissions.
- **Square:** source of completed prepared-drink sales and coupon redemptions. The live variable-percentage discount is named `50% Off First Drink — Enter 50%`; staff applies it only to one eligible prepared-drink line and enters `50` when the website coupon is shown. The next genuine redemption should verify exact half-off, no stacking, receipt/report visibility and the transaction ID. This provides an aggregate directional redemption rate without a custom Square integration.
- **Online ordering:** the existing Square/Cash App ordering profile remains linked at `https://cash.app/$spartannutritionok`. Its public availability is separate from full checkout, tax, discount, receipt and inventory QA.
- **Our menu:** `data/menu.json`, because the Square catalog does not represent all prepared-drink flavors clearly enough for customers.
- **To-Go Teas and Mega Tea Kits:** `data/mega-tea-kits.json`, reconciled to the current live Square items, modifier choices and prices. The generated section links to the existing online-pickup profile and keeps an availability caveat because live choices and inventory can change.
- **Featured special menu:** `assets/current-release-menu.webp`, replaced as one owner-managed image while its recipes remain available.
- **Home-product shipping:** the owner-attributed external storefront is `https://get-started.herbalife.com/en-us/u`. The public website links to its stable Shop All and Wellness Rewards routes. Herbalife is merchant of record and handles account creation, payment, taxes, shipping, subscriptions, returns and membership terms. Spartan does not collect enrollment/payment/shipping data or fulfill these orders.
- **Home-product measurement:** `home_products_view`, `home_delivery_click` and `member_savings_click` are anonymous GA4 website-intent events only. The product-shipping page does not load Meta Pixel, and health-adjacent product-interest events are withheld from Meta. A click is not a completed order or membership. Reconcile completions from authenticated Herbalife owner reporting; do not invent a cross-domain conversion or upload customer data without an approved privacy/consent basis.
- **Meta:** current homepage/menu analytics are retained for general menu, call, directions, coupon and Mega Tea Kit actions. The shipped-products page does not load Meta Pixel, and `assets/site.js` blocks health-adjacent at-home product-interest event names from Meta.
- **Google Analytics:** GA4 property `Spartan Nutrition Website` uses web stream `Spartan Nutrition Website` and measurement ID `G-C3R237CCQ7`. The production-host-only loader disables automatic page views and advertising signals; `assets/site.js` removes form-result parameters before sending one page view and the site’s anonymous action events. It preserves only allowlisted campaign and click-identification parameters so approved Facebook, Instagram, TikTok, Google Business Profile and Brevo links can be attributed without putting names, email addresses or phone numbers into analytics. Enhanced Measurement retains page loads and scrolls only; history-change page views and the automatic click, form, search, video and download events are off. Google signals and user-provided-data collection remain off, event/user retention remains at 2/14 months, and `script.google.com` is excluded as a referral so a native fallback return does not overwrite the visitor’s original source. `email_doi_requested` records provider acceptance of a confirmation-email request. `email_confirmation_return` is only a directional redirect signal because its URL can be revisited; it is not a confirmed-subscriber count or key event. `coupon_confirmed` is the website key event. Brevo list membership remains the authoritative email-confirmation source. Do not send form field values or other personal information.
- **Email delivery:** the Sheet remains the consent audit source. Only rows with `email_consent_status=granted` may sync to the dedicated Brevo list. Provider suppressions and unsubscribes must never be cleared by the website sync.
- **Owner submission alerts:** each newly appended coupon or email-signup row enters a Sheet-backed notification queue. A separate 15-minute Apps Script trigger sends one counts-only message to the owner inbox and records delivery state; customer details remain in the restricted Sheet, and mail failure cannot block the public form.

The Sheet includes optional owner-managed fields for coupon redemption status, redemption date and Square transaction ID. Phase 1 does not automatically join Square transactions to website contacts; that would require credentials, API design and a reliable staff/POS identifier.

Do not send campaigns directly from the Sheet. Export or synchronize only records whose `email_consent_status` is `granted` to an email platform that provides unsubscribe and suppression handling. Keep all historic unknown-consent contacts quarantined from recurring email and SMS marketing.

No one-time re-permission email or text to historic contacts is implemented here. A message asking for marketing permission may itself be regulated or restricted by a delivery provider. Review the exact historic source, proposed wording, channel and recipient segment with the chosen provider—and obtain qualified compliance guidance where appropriate—before sending anything to unknown-consent contacts.
