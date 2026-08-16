# External configuration record

This file records external configuration that cannot be inferred from GitHub alone. It contains no credentials or customer data. Treat every item as a dated snapshot and reverify it after account, DNS, analytics or deployment changes.

## Verified August 16, 2026

### Google owner submission alerts

- The existing Apps Script web-app deployment was updated in place to Version 13 without changing its public `/exec` URL, form contract, Worker route, Brevo double-opt-in state or legacy cutoff.
- The owner-alert mail scope was authorized by the durable Spartan business Google account before permanent trigger activation.
- A controlled coupon submission created one Sheet row with a pending alert; manual processing sent one counts-only owner email. An exact replay created no row or second alert, and a second processor run returned idle.
- Exactly one permanent time-based trigger owned by the Spartan business account now runs `processPendingOwnerNotifications` every 15 minutes from the Head deployment.
- The trigger completed an automatic run on August 16 with a 0% error rate. The final diagnostic reported `operational: true`, one current-account trigger, zero pending, zero attempting and zero failed alerts.
- Historic rows with blank alert status were not backfilled. Customer names, phone numbers and email addresses remain in the restricted Sheet and are not included in owner-alert emails.

### Google Search Console refresh

- The existing `https://spartandrink.com/sitemap.xml` submission remains successful and now reports five submitted URLs discovered. It was not duplicated or replaced.
- URL Inspection reported **URL is on Google** and **Page is indexed** for the homepage, `/menu/` and `/products-at-home/`.
- All three pages passed a fresh live test as available to Google and eligible for indexing.
- Breadcrumbs validation reported one valid item for both the menu and shipped-products pages.
- Fresh indexing was requested for all three pages. Google confirmed that each URL was added to its priority crawl queue; this is not a ranking or recrawl-time guarantee.

### Google Business Profile menu state

- Contact settings still show the tracked canonical website URL and the listed Facebook, Instagram and TikTok profiles.
- **Edit menu** showed 87 items, a green selected indicator and zero menu photos; the meaning or source of the indicator was not inferred.
- The separate **Menu link** field described in Google Business Profile help is not available in this profile's Contact settings.
- Food ordering is enabled, but no service-provider links are configured. The website menu was not added as an ordering link because customers cannot complete an order on that page.
- No category, menu item, ordering, website, social-profile or other profile field was changed during this check.
- Do not change the primary category merely to unlock a menu URL. Recheck field eligibility later or contact Business Profile support if a separate website-menu link remains important.

### Cloudflare route recheck

- `/menu/index.html` and `/products-at-home/index.html`, on both apex and `www`, each complete one `301` redirect to the matching clean trailing-slash URL, preserve tested query parameters and finish with `200`.

## Verified August 15, 2026

### Cloudflare

- `Always Use HTTPS` is enabled.
- The canonical `/index.html` redirect is active for apex and `www` hosts.
- Legacy `/spartan-landing`, `/spartan-landing/`, `/spartan-landing/index.html` and `/index_updated.html` requests redirect to the HTTPS apex homepage.
- The `www` rule redirects other requests to the apex host.
- Tested redirects were single-hop and preserved campaign query parameters.
- A root TXT record verifies the `spartandrink.com` Search Console domain property. Do not remove it while the property is in use.

### Google Search Console

- Domain property: `sc-domain:spartandrink.com`
- Ownership method: DNS TXT through Cloudflare
- Sitemap: `https://spartandrink.com/sitemap.xml`
- Submission status on August 15: Success; three pages discovered
- New-property reports were still processing and correctly stated that data may take a day or more to appear.

### Google Analytics 4

- Account: `Spartan Nutrition` (`404169165`)
- Property: `Spartan Nutrition Website` (`549340793`)
- Measurement ID: `G-C3R237CCQ7`
- Search Console domain property linked to web stream `Spartan Nutrition Website` on August 15.
- Spartan Nutrition Google Business Profile linked to the same GA4 property on August 15.
- `coupon_confirmed` remains marked as a key event. The replayable `email_signup_confirmed` event was unmarked; this release instead uses non-key `email_confirmation_return` as a directional redirect signal, while Brevo list membership is the email source of truth.
- The live tag was observed sending a successful page-view request before this release. This proves collection at that time, not historical comparability with the legacy site.

### Google Business Profile

- Listing: Spartan Nutrition, 15020 South Memorial Drive C, Bixby, Oklahoma 74008
- Website changed from the legacy `/spartan-landing/index.html` URL to the canonical homepage with `google / organic / gbp_website` campaign attribution.
- Facebook and Instagram profiles remain attached.
- TikTok profile `https://www.tiktok.com/@spartan_nutrition` was submitted and was pending Google review.
- A revised description was submitted to replace weight-loss, meal-replacement and coaching-style positioning with accurate local-store language covering energy teas, protein and nutrition shakes, protein coffee, seasonal menus, Mega Tea Kits, pickup and nearby communities. It was pending Google review.
- Owner clarification on August 15: Spartan uses **our menu**, **special menus** and **most popular**. Special-menu recipes remain available after a different special is featured; future profile copy should not call them limited-time or contrast them with a “permanent menu.”

### Square online ordering

- An owner-controlled checkout through the public Square/Cash App ordering profile created a paid order in the Square dashboard, confirming that the destination is more than a website click.
- A merchant notification was not observed during that test. Square POS new-order notifications and merchant email alerts still require verification before online pickup is considered operationally complete.

### Meta privacy setting still to verify

- A fresh attempt to inspect Events Manager redirected to Facebook login, so automatic advanced matching and automatic form-event collection were not verified in this session.
- Before production form testing, confirm those account-side features are off or deliberately governed and disclosed. The repository itself does not send form values to Meta.

## Intentionally not changed

- Google Business Profile name, category set, address, phone, hours, service area and menu were not changed in this SEO-linking pass.
- No historic contact was imported or messaged.
- No Meta, TikTok or Google advertising account was linked or activated.
- Facebook, Instagram and TikTok bio links back to the canonical website were not changed in this pass; use the tagged URLs in `SEO-SOCIAL-PLAYBOOK.md` after the release is live.
- No source files or backend code were deployed by these account changes.
