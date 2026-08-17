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

### Brevo welcome and content-interest flow

- The dedicated confirmed-subscriber list remains `Spartan Updates - Website Opt-ins` (list `#3`). Brevo list membership is the authoritative confirmed-subscriber state; current sendability also depends on Brevo unsubscribe, bounce and suppression status.
- A multiple-choice contact attribute named `CONTENT_INTERESTS` stores the subscriber's current selections. Its nine choices cover menus and flavors; holiday/special hours; events, announcements and Spartan Games; promotions and rewards; Mega Tea Kits, make-at-home drinks and shipped products; product/nutrition education; fitness/workout education; free recipes/guides/tools/wellness ideas; and evidence-based health, nutrition and fitness research news.
- Profile-update form `Spartan Content Interests v1` (`6a82189758ceea94e31b307d`) asks subscribers to optionally choose up to three topics. The choices guide future content but do not limit general Spartan Updates. Brevo requires an identifier field, so Email remains on the form. No confirmation email is sent after a preference update, and the form hides after a successful save.
- An owner-controlled test updated the same Brevo contact twice, preserved its membership on list `#3`, retained the latest selections and created no duplicate contact.
- Automation `Spartan Updates — Welcome + Interests v1` (automation `#1`) triggers when a contact is added to list `#3`, waits two minutes, and sends message `#6`. Re-entry is off.
- The welcome message links to the contact-specific Brevo profile-update form, not to a public or reusable form URL. It also links to the Spartan website with approved campaign labels and retains Brevo's unsubscribe controls.
- Two owner-only automation tests were processed and delivered. The delivered messages had passing DKIM, SPF and DMARC results, a working one-click unsubscribe header and the intended reply-to address.
- The current Gmail From address is rewritten by Brevo to an authenticated `brevosend.com` sender address. This is functional but less branded; an authenticated `@spartandrink.com` sender is a later deliverability/branding improvement.
- The automation was activated on August 16 after the matching website privacy disclosure was verified live. Contact re-entry remained off. Future contacts added to list `#3` enter the flow; existing list members were not entered retroactively.

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

### Post-coupon discovery-source rollout

- The existing Google Apps Script web-app deployment was updated in place to Version `14`; its deployment ID and public `/exec` URL did not change. Public health retained form handler `spartan-forms-v3.2-2026-08-15`, Worker form contract `spartan-worker-form-v1-2026-08-15`, owner alerts and Brevo configuration, and added discovery contract `spartan-discovery-contract-v1-2026-08-16` plus supported record type `discovery_source`.
- Cloudflare Worker `spartan-form-proxy` was deployed as version `9f7cae22-90f5-4e71-a34c-2d128c73be7c`. Its health endpoint returned `200` with public discovery contract `spartan-discovery-v1-2026-08-16`; both existing form routes and secrets were retained.
- The active rate-limiting rule `Protect Spartan website forms` now covers `POST /api/forms` and `POST /api/forms/discovery`. It remains IP-based at 10 requests in 10 seconds with a 10-second block.
- Pull request `#12` merged as `363aeac0f93dad9bcd96951e5c3e598f2ccaf9a8`, and the live homepage serves the matching `20260816c` CSS and JavaScript release.
- Safe negative tests returned the expected bounded errors for GET, query strings, cross-origin requests, unsupported media types, malformed JSON, extra fields and an unknown submission ID. No negative test created a lead.
- One owner-controlled production QA claim created one new Sheet row. It was labeled `Spartan Discovery QA` with `release_qa / internal / discovery_v1` campaign fields so it can be excluded from business reporting. Email consent remained `not_requested`, Brevo sync remained `not_applicable`, and the coupon response was server-confirmed.
- The first discovery answer updated that same row with the question version, form ID and recorded timestamp. A retry with a different answer returned `already_saved`, confirming first-answer-wins behavior without appending or overwriting another lead.
- The row's owner-notification status reached `sent`, and Gmail received the matching counts-only `Spartan website: 1 new submission` message. The discovery update itself did not generate a second alert.

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

### Square customer-journey audit

- Read-only Dashboard review on August 16, 2026 confirmed Customer Directory access with 3,539 existing customer profiles and a customer form that includes phone plus Reference ID.
- Square Loyalty is not active; its page offers a 30-day trial. The customer-journey baseline will not depend on Loyalty.
- Square Online is on its Free plan. Square for Restaurants Plus is in a free trial ending September 11, 2026. The subscription manager showed the current configuration as $139/month if subscribed and 2.6% + 10¢ versus 2.6% + 15¢ on Free. No plan selection was changed. Square's current restaurant guidance says an unselected trial downgrades to Free; verify the account-specific result before the deadline.
- The account has one visible active location, `Spartan`, with Square location ID `3MDGSXS33HERT`.
- The calendar-year Discounts report separately lists `50% Off First Drink — Enter 50%` and showed $26.12 discounted at audit time. This proves named aggregate reporting, not contact-level redemption attribution.
- One recent paid transaction exposed stable transaction/order/receipt references but no visible customer-profile link. This sample is not a coverage estimate.
- No customer, plan, discount, transaction or account setting was changed. Physical POS customer attachment, fixed-discount behavior, export fields and a controlled redemption/return/reversal path remain to test.

#### August 17 controlled Square update

- The owner changed `50% Off First Drink — Enter 50%` in place from variable percentage to fixed 50%. Its verified catalog object ID is `5ZXWVO3YGDYFHPZBD5KX6JXI`. Applying it from one selected quantity-one Kids Shake line left BCAAs and Protein Coffee full price; applying it to an identical quantity-two line discounted both units, so staff must split the eligible drink first.
- A labeled synthetic test customer's reference code was scanned at the POS and the customer was attached before a paid $3.58 Best Defense transaction. Square retained stable customer, payment, order and location references. The test did not use the website coupon or target discount and must not be backfilled as a redemption.
- Square Text Message Marketing remains `Not subscribed`, and the competing `Collect text subscribers on point of sale` setting was turned off. The confirmation explicitly described disabling checkout collection only; the page then showed `Turn on`, proving the prompt is off without deleting the dormant coupon, subscribers or another marketing setting.
- Square would not accept `Square` in an application name, so the isolated developer application was created as `Spartan First Visit Connector`. A dedicated `Spartan First Visit Sandbox` test seller was created with automatic all-application authorization cleared. Its authorization grants only `CUSTOMERS_READ`, `CUSTOMERS_WRITE`, `ORDERS_READ`, `PAYMENTS_READ` and Square's mandatory `MERCHANT_PROFILE_READ`; the replacement sandbox token expires September 16, 2026.
- One sandbox authorization was revoked immediately after its credentials became visible during setup. A replacement authorization was created with the same least-privilege scopes, verified against the sandbox Locations API and stored only as an encrypted Cloudflare secret. The exposed authorization is no longer valid and no production credential was opened or changed.
- The dedicated sandbox merchant and active U.S. location are recorded in `square-worker/wrangler.sandbox.toml`; its location is different from production `3MDGSXS33HERT`.
- Cloudflare now has isolated runtime and preview D1 databases, a main Queue, a one-day-retention dead-letter Queue, a host-scoped managed Turnstile widget and the workers.dev-only `spartan-square-connector-sandbox` Worker. Both D1 migrations are applied to both databases. The Worker has only the sandbox Square token, two independently generated hashing/session secrets and the Turnstile secret; secret values are not stored in the repository.
- The sandbox Worker is live only at its dedicated workers.dev hostname, has no `spartandrink.com` route and remains inert: all five feature flags are `false`, canary-only mode is `true`, and the canary allowlist is empty. Public config reports `enabled:false`; the offer and webhook routes report disabled; the production site origin is rejected. The existing form Worker was not changed.
- Production still has no automatic website-to-Square customer, group, scan-pass, redemption or later-purchase synchronization. Sandbox discount, customer-group and qualifying-item IDs, Apps Script test-ledger credentials and a webhook signature are intentionally absent, so activation remains blocked until the documented sandbox gates are completed.

### Customer-journey ledger foundation

- A private recovery copy named `Spartan Leads — pre-journey-ledger backup 2026-08-16` was created before the workbook change. Its private file ID is intentionally not stored in the repository.
- The reviewed Apps Script Head code was saved without updating the public web-app deployment. The active production deployment remains Version `14`, with the same deployment ID, public `/exec` URL and handler contracts.
- The read-only preflight reported both `Identity Links` and `Journey Events` missing, the configured `spartan leads` tab valid, zero lead-tab writes and zero journey rows appended.
- `setupJourneyLedgerSheets()` created exactly those two tabs. `Identity Links` has 15 reviewed headers; `Journey Events` has 28. Both contain zero data rows, freeze and bold row 1, and use plain-text formatting for identifiers.
- A post-setup diagnosis returned `ready: true` for both tabs. A second setup returned two verified tabs with zero creations, zero header writes, zero formatting changes, zero protection changes, zero lead-tab writes and zero appended events.
- The existing `spartan leads` view still showed 41 columns and row 247 after setup. Owner-alert diagnosis remained operational with one permanent trigger and no pending, attempting or failed alert. Public Apps Script and Worker health remained unchanged.
- This is schema only. No Square customer, website contact, identity link, journey event, redemption, return, reward or message was created. Event entry remains blocked until the controlled POS proof and append-only writer are completed.

### Meta privacy setting still to verify

- A fresh attempt to inspect Events Manager redirected to Facebook login, so automatic advanced matching and automatic form-event collection were not verified in this session.
- Before production form testing, confirm those account-side features are off or deliberately governed and disclosed. The repository itself does not send form values to Meta.

## Intentionally not changed

- Google Business Profile name, category set, address, phone, hours, service area and menu were not changed in this SEO-linking pass.
- No historic contact was imported or messaged.
- No Meta, TikTok or Google advertising account was linked or activated.
- Facebook, Instagram and TikTok bio links back to the canonical website were not changed in this pass; use the tagged URLs in `SEO-SOCIAL-PLAYBOOK.md` after the release is live.
- No source files or backend code were deployed by these account changes.
