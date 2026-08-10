# Spartan Nutrition website

This repository contains the static website published at [spartandrink.com](https://spartandrink.com/). GitHub Pages serves the files from the `main` branch and Cloudflare manages the public domain, HTTPS and redirects.

## Phase 1 structure

- `index.html` — primary landing page and canonical homepage.
- `assets/site.css` and `assets/site.js` — shared presentation and interactions.
- `data/menu.json` — structured permanent menu source.
- `data/mega-tea-kits.json` — structured source for Mega Tea Kit choices, optional Liftoff flavors, add-ins and prices.
- `assets/current-release-menu.webp` — the replaceable seasonal/current release image.
- `privacy.html` — website and subscriber privacy disclosures.
- `offer-terms.html` — first-drink offer rules.
- `apps-script/` — source and deployment instructions for the Google Sheet form handler.
- `spartan-landing/index.html` and `index_updated.html` — legacy browser redirects retained until Cloudflare HTTP redirects are configured.

## Routine owner updates

### Replace the current release menu

1. Export the new menu as a clear portrait JPG, PNG or WebP image.
2. Convert and resize it to WebP before uploading. From the repository folder on a Mac with `cwebp` installed:

   ```sh
   cwebp -q 82 -resize 1200 0 "/path/to/new-menu.jpg" -o assets/current-release-menu.webp
   ```

3. Update the release title, description and image alt text in the `current-release` section of `index.html`.
4. Preview the website on both phone and desktop before publishing.

Replacing the file with the same name automatically removes the previous release from the live page while preserving a simple update workflow.

### Update the permanent menu

1. Edit `data/menu.json`.
2. Generate the matching accessible HTML:

   ```sh
   node scripts/build-menu.mjs
   ```

3. Review `index.html` and preview the page.

The same build step also refreshes the Mega Tea Kit section from its separate data file without changing the permanent prepared-drink menu.

### Update Mega Tea Kits

Use the current live Square Ordering Profile as the source of truth before changing kit options or prices.

1. Edit `data/mega-tea-kits.json` rather than editing the generated kit lists in `index.html`.
2. Keep the three main selection groups separate: build-your-own flavors, Spartan favorites and more named recipes.
3. Update the optional Liftoff list, paid add-ins, base price and `lastReviewed` date only when the live Square setup changes.
4. Generate the accessible website section:

   ```sh
   node scripts/build-menu.mjs
   ```

5. Run `node scripts/validate-site.mjs`. The validator confirms 51 build-your-own flavors, 15 Spartan favorites, 46 additional named recipes, 8 optional Liftoff flavors and 30 paid add-ins, checks for duplicate entries, and confirms that every data-file choice appears on the page.
6. Preview the collapsed and expanded lists on both phone and desktop. Confirm the online-pickup button reaches the current Spartan ordering profile before publishing.

The website includes current catalog choices for discovery, but availability can change. Keep the visible availability note and avoid promising inventory that has not been verified in Square.

### Update hours or contact information

Update both the visible `visit` section and the `LocalBusiness` JSON-LD block near the top of `index.html`. Keeping them aligned prevents customers and search engines from seeing different hours.

### Validate before publishing

Run the dependency-free validation script after changing content, forms, menu data, links or business information:

```sh
node scripts/validate-site.mjs
```

It checks local page and asset references, anchor targets, structured data, JavaScript syntax, permanent-menu and Mega Tea Kit data/rendering parity, Google Sheet headers, coupon behavior and email-consent behavior. It does not replace visual browser testing, live Square availability checks or a real Apps Script deployment test.

### Preview before publishing

From the repository folder, start a local preview:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4173/`. Preview mode on every non-production hostname prevents coupon and email forms from submitting and does not load the production Google tag or Meta Pixel. Stop the preview with `Control-C` when finished.

The stylesheet and browser script use a date-based `?v=` value in page references so GitHub Pages and Cloudflare visitors receive a new file after a release. Update that value in `index.html`, `privacy.html` and `offer-terms.html` whenever `assets/site.css` or `assets/site.js` changes.

## Form deployment gate

The refreshed forms use a POST-and-redirect flow so a coupon or signup success is shown only after a Sheet write. The transitional Apps Script also accepts legacy GET coupon claims from cached copies of the old page. Update and test that backward-compatible handler before publishing this website, then remove GET compatibility only after old routes and caches have been clear long enough to make it safe. Follow [`apps-script/README.md`](apps-script/README.md).

Coupon claims do not create marketing permission unless the visitor separately selects the optional, unchecked email-updates box. The dedicated email signup remains available for visitors who do not claim the offer. SMS signup is not included in Phase 1.

## Pre-publish checklist

1. Confirm the featured menu image and accompanying drink names are current.
2. Confirm hours, phone, email, address and social links.
3. Update and test the Apps Script using clearly labeled internal records for both the legacy GET coupon path and the new POST forms.
4. Confirm the email-signup consent columns appear in Google Sheets.
5. Test coupon claim, email signup, modal keyboard behavior, calls and directions.
6. Confirm Meta receives `PageView` and a single `Lead` only after a successful coupon return.
7. Confirm GA4 receives page views and approved anonymous events without names, email addresses or phone numbers.
8. Confirm a newly granted email opt-in reaches the approved Brevo list while an unchecked coupon does not.
9. Review the privacy and offer terms against the final provider configuration.
10. Publish the repository changes to GitHub only after approval.
11. Configure Cloudflare HTTP 301 redirects for `/spartan-landing/`, `/spartan-landing/index.html` and `/index_updated.html` to `/`.

No customer data, API keys, spreadsheet IDs or provider credentials should be committed to this repository.

## Phase 1 data and measurement boundaries

- **Google Sheet:** source of website coupon claims and auditable email permissions.
- **Square:** source of completed prepared-drink sales and coupon redemptions. The live variable-percentage discount is named `50% Off First Drink — Enter 50%`; staff applies it only to one eligible prepared-drink line and enters `50` when the website coupon is shown. The next genuine redemption should verify exact half-off, no stacking, receipt/report visibility and the transaction ID. This provides an aggregate directional redemption rate without a custom Square integration.
- **Online ordering:** the existing Square/Cash App ordering profile remains linked at `https://cash.app/$spartannutritionok`. Its public availability is separate from full checkout, tax, discount, receipt and inventory QA.
- **Permanent menu:** `data/menu.json`, because the Square catalog does not represent all prepared-drink flavors clearly enough for customers.
- **Mega Tea Kits:** `data/mega-tea-kits.json`, reconciled to the current live Square kit, modifier choices and prices. The generated section links to the existing online-pickup profile and keeps an availability caveat because live choices and inventory can change.
- **Featured release:** `assets/current-release-menu.webp`, replaced as one owner-managed image.
- **Meta:** current website analytics retained. Custom events are emitted for menu, call, directions, coupon, at-home and Mega Tea Kit actions.
- **Google Analytics:** GA4 property `Spartan Nutrition Website` uses web stream `Spartan Nutrition Website` and measurement ID `G-C3R237CCQ7`. The production-host-only loader disables automatic page views and advertising signals; `assets/site.js` removes form-result parameters before sending one clean page view and the site’s anonymous action events. Enhanced Measurement retains page loads and scrolls only; history-change page views and the automatic click, form, search, video and download events are off. Google signals and user-provided-data collection remain off, event/user retention remains at 2/14 months, and `script.google.com` is excluded as a referral so a form return does not overwrite the visitor’s original source. `email_doi_requested` records a confirmation-email request; only the Brevo confirmation return records `email_signup_confirmed`. `coupon_confirmed` and `email_signup_confirmed` are pre-created as key events with no assumed dollar value; Brevo list membership remains the email source of truth. Do not send form field values or other personal information.
- **Email delivery:** the Sheet remains the consent audit source. Only rows with `email_consent_status=granted` may sync to the dedicated Brevo list. Provider suppressions and unsubscribes must never be cleared by the website sync.

The Sheet includes optional owner-managed fields for coupon redemption status, redemption date and Square transaction ID. Phase 1 does not automatically join Square transactions to website contacts; that would require credentials, API design and a reliable staff/POS identifier.

Do not send campaigns directly from the Sheet. Export or synchronize only records whose `email_consent_status` is `granted` to an email platform that provides unsubscribe and suppression handling. Keep all historic unknown-consent contacts quarantined from recurring email and SMS marketing.

No one-time re-permission email or text to historic contacts is implemented here. A message asking for marketing permission may itself be regulated or restricted by a delivery provider. Review the exact historic source, proposed wording, channel and recipient segment with the chosen provider—and obtain qualified compliance guidance where appropriate—before sending anything to unknown-consent contacts.
