# Spartan Nutrition website

This repository contains the static website published at [spartandrink.com](https://spartandrink.com/). GitHub Pages serves the files from the `main` branch and Cloudflare manages the public domain, HTTPS and redirects.

## Phase 1 structure

- `index.html` — primary landing page and canonical homepage.
- `assets/site.css` and `assets/site.js` — shared presentation and interactions.
- `data/menu.json` — structured permanent menu source.
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

### Update hours or contact information

Update both the visible `visit` section and the `LocalBusiness` JSON-LD block near the top of `index.html`. Keeping them aligned prevents customers and search engines from seeing different hours.

### Validate before publishing

Run the dependency-free validation script after changing content, forms, menu data, links or business information:

```sh
node scripts/validate-site.mjs
```

It checks local page and asset references, anchor targets, structured data, JavaScript syntax, menu JSON, Google Sheet headers, coupon behavior and email-consent behavior. It does not replace visual browser testing or a real Apps Script deployment test.

## Form deployment gate

The refreshed forms use a POST-and-redirect flow so a coupon or signup success is shown only after a Sheet write. Update and test the Google Apps Script before publishing this website. Follow [`apps-script/README.md`](apps-script/README.md).

Coupon claims do not create marketing permission unless the visitor separately selects the optional, unchecked email-updates box. The dedicated email signup remains available for visitors who do not claim the offer. SMS signup is not included in Phase 1.

## Pre-publish checklist

1. Replace or explicitly confirm the featured menu image. The checked-in image is the repository's existing Golden Hour/August menu and must not be assumed current.
2. Confirm hours, phone, email, address and social links.
3. Update and test the Apps Script using clearly labeled internal records.
4. Confirm the email-signup consent columns appear in Google Sheets.
5. Test coupon claim, email signup, modal keyboard behavior, calls and directions.
6. Confirm Meta receives `PageView` and a single `Lead` only after a successful coupon return.
7. Review the privacy and offer terms against the final provider configuration.
8. Publish the repository changes to GitHub only after approval.
9. Configure Cloudflare HTTP 301 redirects for `/spartan-landing/`, `/spartan-landing/index.html` and `/index_updated.html` to `/`.

No customer data, API keys, spreadsheet IDs or provider credentials should be committed to this repository.

## Phase 1 data and measurement boundaries

- **Google Sheet:** source of website coupon claims and auditable email permissions.
- **Square:** source of completed prepared-drink sales and coupon redemptions. Create one POS discount named `Website First Drink - 50%` and have staff apply it only when the website coupon is shown. This gives an aggregate redemption count without a custom Square integration.
- **Permanent menu:** `data/menu.json`, because the Square catalog does not represent all available flavors clearly enough for customers.
- **Featured release:** `assets/current-release-menu.webp`, replaced as one owner-managed image.
- **Meta:** current website analytics retained. Custom events are emitted for menu, call, directions, coupon and at-home actions.
- **Google Analytics:** the page emits `dataLayer` events, but no GA4 measurement ID was available to configure. Add GA4 only after confirming the correct property.

The Sheet includes optional owner-managed fields for coupon redemption status, redemption date and Square transaction ID. Phase 1 does not automatically join Square transactions to website contacts; that would require credentials, API design and a reliable staff/POS identifier.

Do not send campaigns directly from the Sheet. Export or synchronize only records whose `email_consent_status` is `granted` to an email platform that provides unsubscribe and suppression handling. Keep all historic unknown-consent contacts quarantined from recurring email and SMS marketing.

No one-time re-permission email or text to historic contacts is implemented here. A message asking for marketing permission may itself be regulated or restricted by a delivery provider. Review the exact historic source, proposed wording, channel and recipient segment with the chosen provider—and obtain qualified compliance guidance where appropriate—before sending anything to unknown-consent contacts.
