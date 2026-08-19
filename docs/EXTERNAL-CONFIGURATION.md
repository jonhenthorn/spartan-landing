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
- Square would not accept `Square` in an application name, so the isolated developer application was created as `Spartan First Visit Connector`. A dedicated `Spartan First Visit Sandbox` test seller was created with automatic all-application authorization cleared. Its fresh runtime authorization is limited to `CUSTOMERS_READ`, `CUSTOMERS_WRITE`, `ORDERS_READ`, `PAYMENTS_READ` and Square's mandatory `MERCHANT_PROFILE_READ`; it expires September 16, 2026. A separate temporary transaction-fixture authorization had only the sandbox order/payment permissions needed for the controlled test and was revoked after the test completed.
- Two earlier sandbox authorizations were revoked immediately after their credentials became visible during setup. During the later sandbox diagnosis, the sandbox-only Apps shared secret appeared in diagnostic output; it was rotated immediately in both Apps Script and the Worker. None of those exposed credentials remains valid, no credential value is stored in the repository and no production credential was opened or changed.
- The dedicated sandbox merchant and active U.S. location are recorded in `square-worker/wrangler.sandbox.toml`; its location is different from production `3MDGSXS33HERT`.
- Cloudflare has isolated runtime and preview D1 databases, a main Queue, a one-day-retention dead-letter Queue, a host-scoped managed Turnstile widget and the workers.dev-only `spartan-square-connector-sandbox` Worker. Migrations `0001`, `0002` and reviewed retry-scheduler migration `0003` are applied to both databases. The completed core-path exercise used Worker version `ef14512d-35c4-4570-b6bd-e9768585c8ae` in deployment `8ec3705a-9428-46d3-9aff-dc727ffff559`. Its hashing, session, Turnstile, webhook-signature and Apps transport secrets exist only as encrypted provider-side secrets.
- The sandbox is live only at its dedicated workers.dev hostname and has no `spartandrink.com` route. For the bounded reconciliation-only proof, `SQUARE_CONSUMER_ENABLED` and `SQUARE_RECONCILIATION_ENABLED` were temporarily set to `true` while `SQUARE_OFFER_ENABLED`, `SQUARE_WEBHOOK_ENABLED`, `SQUARE_PASS_ENABLED` and the sandbox owner-harness flag remained `false`; canary-only mode retained an empty allowlist. The four-event Square webhook subscription stayed disabled, sandbox Apps `SQUARE_JOURNEY_ENABLED` stayed `false`, and the production site origin remained rejected. After the two-cycle proof, reconciliation was turned off first, terminal/dead state was rechecked, then the consumer was turned off. Worker version `6081f8ec-3626-4731-aa3d-c1abf065e2d9` was the all-off result of that historical proof. After later credential rotations, current connector version `0ff5a2ab-2f2c-4872-a624-29d976ab54de` remains bound to runtime D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`; all five automation flags and the owner-harness flag are `false`, canary-only mode is `true` with an empty allowlist, and public config reports `enabled:false`.
- The sandbox fixture contains Tea at $10, Shake at $12, an ineligible Add-On at $2, one fixed 50% line-item discount, separate Eligible/Redeemed groups and an allowlist containing only the Tea and Shake variation IDs. A real signed webhook safely ignored an unrelated $2 order with no linked customer. The isolated same-origin owner harness and real Turnstile then connected one synthetic claim, created one intended Square profile/link, added the Eligible group and displayed its non-PII Code128 checkout profile code.
- One controlled qualifying order applied the single $5 discount to one quantity-one $10 Tea while leaving the $2 Add-On full price. Its exact $7 completed payment produced one purchase and one redemption, removed the Eligible group, added the Redeemed group and made the checkout profile code unusable. A subsequent full $7 refund opened one review while the claim remained redeemed; it did not restore eligibility, issue another offer or alter the Redeemed group.
- Under the durable Spartan business Google account, an owner-only sandbox folder, sandbox ledger Sheet and bound sandbox Apps Script project were configured. Sandbox Apps Version `2` uses the same private deployment URL and wrote one verified identity link plus `identity_linked`, `order_completed`, `coupon_redeemed` and full `order_refunded` events. The first append exposed that Google had reset the appended identifier cells to Automatic formatting, so connector traffic was paused. The reviewed row writer now formats exact identifier cells as plain text before writing; the owner repair changed 15 formats with zero value writes, row appends or lead-tab writes, a second repair was a zero-change no-op, and the final diagnostic returned `ledger_ready=true`. `SQUARE_JOURNEY_ENABLED` is now `false`.
- A one-time runtime D1 recovery drill exported the isolated sandbox database and verified its SHA-256 digest before importing it into both a disposable remote D1 database and a local SQLite database. The remote import completed 47 queries and 158 row writes across 11 business tables; every source/restore row and state aggregate matched. Local SQLite returned `ok` from its integrity check and no foreign-key violations. A separate disposable D1 Time Travel drill inserted one baseline row, captured a bookmark, inserted one post-bookmark row, restored to the bookmark and verified baseline `1` / post-bookmark `0`. Both disposable remote databases and the local restore files were deleted, and the original runtime database was never restored or mutated by either drill. Wrangler displayed an hour-lived signed download URL in operator output; it is not reproduced here, the dump contained only synthetic/internal IDs and no raw contact PII, and the URL expired automatically.
- The first reconciliation-only sandbox cycle at `2026-08-18T01:35:50.978Z` discovered exactly three events: an unlinked ordinary sandbox payment that was ignored, an additional tender for the already-recorded order that processed idempotently, and the qualifying-order refund that processed. The second scheduled cycle at `2026-08-18T01:40:49.281Z` retained exactly those three deterministic receipts without adding or changing business records. After both cycles, every receipt was terminal and scrubbed; state remained one redeemed claim requiring refund review, one purchase/payment mapping/redemption/refund review and four `DONE` outbox rows, with zero nonterminal webhook rows and zero pending, retry or dead outbox rows.
- At the close of the initial monitoring proof, Cloudflare had separate ENAM runtime and preview operations D1 databases plus scheduled-only Worker `spartan-square-ops-sandbox`. Migration `0001` was applied to both databases. Worker version `337e95fc-61f3-4fa2-aa1a-91b5893887c0` had only a scheduled handler, no public route or `workers.dev` hostname, bound the runtime operations D1 and real sandbox connector D1, and had all four operations capability flags and reconciliation expectation set to `false`. A scheduled interval in that state wrote zero rows.
- A disposable operations proof Worker used separate schema-complete and empty source databases, never the real connector ledger. Remote runs proved healthy, 12-minute warning, 32-minute critical escalation, missing-schema and malformed-timestamp `FAILED/UNAVAILABLE`, preserved incidents during source failure, and healthy recovery with zero active incidents. Concurrent older-warning/newer-healthy D1 batches left one resolved history episode and no active incident. At the close of that proof, the operations D1 retained eight aggregate monitor runs and two resolved fixed-code incidents, with zero active incidents, deliveries, backup runs or restore tests. The disposable Worker, both disposable source databases and the direct guard rows were deleted after exact preflight checks.
- At that time, the sandbox operations configuration intentionally omitted R2 because the account had not enabled it and the recurring-backup lane was not implemented. Production operations resources remained placeholders. No alert recipient, email binding, Queue/DLQ depth reader, backup object or restore executor was added.
- Production still has no automatic website-to-Square customer, group, barcode, redemption or later-purchase synchronization. The production website, form Worker, Apps deployment, Sheet data, Brevo flow and Square account were unchanged by the isolated sandbox exercise. The one-time D1 restore, two-cycle reconciliation, isolated flag-order rollback and aggregate D1 monitor are useful proofs, but they do not close recurring backup, retention/deletion, Queue/DLQ recovery, broader-source monitoring, live external-alert, full production owner-rollback or production owner-canary gates in `docs/SQUARE-CONNECTOR-ROLLOUT.md`.

#### August 18 inert operations alert-engine update

- Alert migration `0002_alert_delivery_engine.sql` was applied preview-first to the isolated sandbox operations databases, then to runtime. Preview remained empty. Runtime preserved eight monitor runs and two resolved fixed-code incidents, with zero active incidents, alert deliveries, backup runs, restore tests or orphan deliveries. Remote schema inspection found 27 `alert_deliveries` columns, all 12 required fields, the required delivery index present, and zero orphan deliveries. The runtime export restored locally with SQLite integrity `ok` and no foreign-key failures.
- Scheduled-only Worker version `a49059b4-6226-4cc9-be6e-ba65d94ab509` was deployed at 100% with schema `2` before the later schema-3 update, using only the runtime operations and real sandbox connector D1 bindings and no email, Queue, R2, secret or public-route binding. All four operations capability flags and reconciliation expectation were `false`. Its next five-minute trigger left all row counts and prior update timestamps unchanged.
- Cloudflare native Email Service is the selected least-privilege design for future owner/backup alerts. This work did not configure or verify a sending domain, sender DNS, verified destination, role binding or live message; the deployed Worker has no email binding. The read-only Email Service sending-list check was not authorized, so account-level sender/destination readiness remains unverified. Cloudflare Email Routing remains disabled/unconfigured and was not enabled for this work. `ops-sandbox.spartandrink.com`, `ops.spartandrink.com` and their sender addresses remain proposals only.

#### August 18 inert Queue/DLQ metrics-source update

- Queue alert migration `0003_queue_monitoring_alerts.sql` was applied to operations preview first, then runtime. Preview remained empty. Runtime preserved eight monitor runs and two resolved fixed-code incidents, with zero active incidents, alert deliveries, backup runs, restore tests or orphan deliveries. Both databases have all 27 delivery columns, both reviewed indexes and the three exact Queue alert/reason pairs; remote foreign-key checks returned no rows.
- A private runtime export taken before migration and a second export taken afterward restored locally. The post copy passed SQLite integrity and foreign-key checks, and bidirectional comparisons found zero monitor-run or incident-row differences; delivery/backup/restore rows remained zero. The temporary SQL/SQLite copies were deleted after proof. Wrangler printed hour-lived signed download URLs during export; they are not reproduced here and expire automatically.
- Scheduled-only Worker version `29ab2f6c-265f-4542-81ec-a4dbf41f2a0b` was deployed at 100% with schema `3` before the later schema-4 update, using runtime operations D1 `2e2fc9f6-0a81-453b-9af6-8d4104965f8e`, real sandbox connector D1 `9531221e-cabe-4ed4-b7d4-f715798b8945`, all five capability flags false, and no secret, Queue, email, R2 or public-route binding. The non-secret account/main/DLQ IDs were inert variables only. Its next five-minute trigger left every row count and prior update timestamp unchanged.
- No Queue-read token was created or installed, `OPS_QUEUE_MONITORING_ENABLED` remained `false`, and no metrics request, message read/write, alert or customer-facing change occurred. A separately approved account-scoped Queues Read token and labeled empty/stale/DLQ/partial-failure/recovery test remain required before the source can be enabled even in sandbox. Production remains untouched.

#### August 18 inert Apps-health schema-4 update

- The existing sandbox Apps web-app deployment was updated in place to Version `3`, description `sandbox-ledger-v3-2026-08-18-apps-health-disabled`, with the same URL, execute-as owner and `Anyone` access. The reviewed signed health contract is present, `OPS_HEALTH_ENABLED=false`, the environment is `sandbox`, and no dedicated health shared secret was installed. The public GET remained the same v3.2 form-service response; no signed health POST or Sheet inspection was performed.
- During the settings step, the pre-rotation sandbox Square-connector shared secret was rendered into automation output and must be treated as compromised. A replacement was installed in both sandbox stores while the connector remained disabled. Local clipboard and temporary variables were cleared where possible, but historical output containing the revoked value remains sensitive. Cross-system use of the replacement was not exercised during that rollout. Connector version `0d017304-0002-421b-b94a-fb3251c6c9e7` was the historical result; later preflight disclosures required further rotations, and current connector version `0ff5a2ab-2f2c-4872-a624-29d976ab54de` remains fully disabled. No current secret is recorded in Git.
- Migration `0004_apps_script_health_alerts.sql` was applied to the empty preview operations D1 first and then runtime. Preview remained at zero rows. Runtime preserved eight monitor runs and two resolved incidents, with zero active incidents, alert deliveries, backups or restore tests. Both databases retain 27 delivery columns, both reviewed indexes and the three exact Apps-health pairs; remote foreign-key checks were clean, and private post-migration exports passed SQLite integrity and foreign-key checks. The temporary schema-4 export directory was moved to the owner's Trash and remains recoverable.
- Scheduled-only operations Worker version `804dae4f-44d8-45de-a6e1-6ca3182d682e` was the historical inert schema-4 deployment, with the exact runtime operations and connector D1 bindings, every monitoring/Queue/Apps/alert/backup/restore flag false, and no secret, Apps URL, Queue, email, R2 or public-route binding. Its 9:15 a.m. Central trigger plus settling minute left all five table counts and prior update timestamps unchanged. The August 18 acceptance cleanup later produced then-current version `65e97390-997e-46e8-9afa-f8721c644ef0`, recorded in the next historical subsection.
- This rollout proves only default-off deployment and preservation. Configuring the existing Apps deployment URL in the operations Worker, installing one new dedicated health secret as Apps `OPS_HEALTH_SHARED_SECRET` and Worker `OPS_APPS_SCRIPT_HEALTH_SHARED_SECRET`, signed disabled/healthy/failure/mismatch/recovery tests within the five-second budget, restoring `OPS_HEALTH_ENABLED=false`, `OPS_APPS_SCRIPT_MONITORING_ENABLED=false` and `OPS_MONITORING_ENABLED=false`, Queue token/tests, external alerts, backups/restores and any production activation remain separately blocked.

#### August 18 signed Apps-health acceptance attempt — failed and rolled back

- The owner approved the bounded sandbox worksheet. Baseline was operations Worker `804dae4f-44d8-45de-a6e1-6ca3182d682e`, eight monitor runs, two resolved/zero active incidents and zero deliveries/backups/restores. Apps Version `3` had health false, environment `sandbox` and no health secret. Connector aggregates were zero.
- A private Apps-property preflight rendered the then-current sandbox connector shared secret into automation output. It was treated as compromised and replaced in both disabled sandbox stores before health setup continued. At that historical close, connector version `cf69ea69-4d5e-4aae-8e59-b85341b8eb3a` was at 100% with the runtime connector D1, all five automation flags and the owner harness false, canary-only true with an empty allowlist, and public configuration disabled. The deployment screen also rendered the private Apps URL; it is not an authentication credential and the HMAC health secret did not exist at that time, but the historical output remains sensitive. No current secret or private URL is recorded in Git.
- Credential-inert operations version `470d9ef0-f349-44e5-b3a6-7a9723327375` had only the two reviewed health secret names, exact runtime D1 bindings and all six flags false. Multiple scheduled intervals changed no D1 count or prior timestamp.
- Enabled-test version `f68abb5f-2507-4af3-8f46-40b4b87a61ea` set only aggregate monitoring and Apps monitoring true. Two direct calls returned signed `DISABLED` in `1500 ms` and `1485 ms`. Because the supervised interval ran longer than planned, nine consecutive five-minute unavailable observations—not two—were retained as one warning episode with zero deliveries.
- The first enabled full inspection failed the strict `<5000 ms` acceptance gate at `5016 ms`. An immediate repeat returned valid signed `COMPLETE`, configuration healthy, in `3878 ms`, but it did not override the stop rule. Forced environment failure, configuration mismatch and recovery phases were not run.
- Emergency cleanup restored Apps health false/environment sandbox, removed `OPS_HEALTH_SHARED_SECRET`, cleared the temporary Keychain/clipboard material, and removed both Worker health secrets. The August 18 final operations version `65e97390-997e-46e8-9afa-f8721c644ef0` was at 100%, scheduled-only, schema `4`, bound only to the exact runtime D1 databases, with no secret or unexpected binding and every capability false. The next all-off cron changed no count or prior maximum timestamp.
- At the August 18 close, operations D1 had 17 monitor runs, three incidents and one open `APPS_HEALTH_UNAVAILABLE` warning with occurrence count nine; alert deliveries, backups and restores remained zero. The open warning was retained as failed-run audit evidence. No production, customer, order, coupon, Square, Brevo, website or form state changed. The then-required metadata optimization was later published as Version 4; the August 19 outcome and current retry gate are recorded below.

#### August 19 optimized publication and stopped Apps-health follow-ups

- The exact-semantic health optimization was published as sandbox Apps Version 4 on the existing deployment while health remained disabled. The public form-service contract was unchanged, and the next all-off cron produced no operations or connector write.
- A fresh credential-inert setup passed with operations version `69e5238e-2990-4c8a-b81b-f4ca3fb70b72`: all six capability flags remained false and D1 counts/timestamps did not change. Enabled-test version `a21de7b9-f103-4b18-9be6-1820b81a4eb3` enabled only aggregate and Apps monitoring. Two native signed `DISABLED` probes passed in `1791 ms` and `1009 ms`.
- One cron at `2026-08-19T03:00:44.646Z` recorded `FAILED` / `UNAVAILABLE`, one warning and no delivery. The existing Apps-unavailable incident reset to occurrence one after the confirmation gap exceeded 540 seconds; it was not a new incident.
- The run stopped under its disclosure rule when automation output displayed the private Apps deployment locator and private Script Property values, including the active sandbox connector signing secret. No private locator or value is retained here. Apps health was never enabled, and the healthy, forced-failure, mismatch and recovery phases were not run.
- Cleanup removed the Apps health property, both operations Worker health secrets and the temporary Keychain/clipboard material. The exposed connector signing secret was revoked and replaced in both disabled sandbox stores. Current connector version `0ff5a2ab-2f2c-4872-a624-29d976ab54de` has all automation and harness flags false, canary-only true and an empty allowlist; connector D1/business state did not change.
- At the close of those follow-ups, operations version `d600bb6e-2a54-44c5-addd-2d3ada1ed393` was schema 4, scheduled-only, secretless and all six flags false. The `03:10` UTC trigger wrote nothing. Operations D1 then contained 18 monitor runs, three incidents, one active `APPS_HEALTH_UNAVAILABLE` warning at occurrence one, and zero deliveries, backups or restores.
- One final exact-selector attempt stopped before any credential was saved or sent because the new property field could not be uniquely resolved. The unsaved blank row was discarded, its unused fresh Keychain credential was deleted, and no Worker secret, flag or D1 state changed. At that point, another attempt required new explicit approval and a separately reviewed owner-controlled property workflow; the later transport work below proceeded only under subsequent approval. Production and all customer/business systems remained untouched.

#### August 19 Apps-health transport diagnostics and final cleanup

- Enabled-test operations version `2c5c7fa7-be5b-44ef-9fac-1b00fdd51920` produced one actual scheduled row from `2026-08-19T06:30:16.250Z` through `2026-08-19T06:30:19.216Z` (`2966 ms`). It recorded `FAILED` / `UNAVAILABLE`, one warning, no critical signal and fixed summary `APPS_HEALTH_SECOND_HOP_UNAVAILABLE`; the sandbox Apps Version 4 execution view showed the corresponding `doPost` completed in `2.069 s`.
- The required signed-disabled scheduled result was not reached, so the run hard-stopped without a second row. Health credentials were removed and all six operations flags returned to false. Connector and production state did not change.
- Detailed bounded second-hop outcome splitting was committed as `76510a0` and deployed inertly as operations version `d90fcd45-ac10-4800-b14b-c4bd882df554`. Its `06:55` cron plus settling proved zero writes while it was scheduled-only, schema 4, bound to the exact runtime D1 databases, secretless and all six flags false.
- A fresh local-only diagnostic returned signed `DISABLED` in `5422 ms` and `1585 ms`; the normal strict probe stopped at `5011 ms`. It stopped before any Worker health secret or flag was installed or enabled and produced no D1 row.
- Cleanup removed the Apps health property and temporary Keychain URL/secret items. Current operations version `d90fcd45-ac10-4800-b14b-c4bd882df554` is the sole 100% deployment, all six flags are false and its secret list is empty. Operations D1 contains 22 monitor runs, three incidents, one active `APPS_HEALTH_UNAVAILABLE` warning at occurrence one, and zero deliveries, backups or restores; the latest row remains the `06:30` sample. Connector aggregates and all production/business state remain unchanged.
- Acceptance remains incomplete. The owner has approved one sandbox-only Option B qualification: a single shared ten-second transport ceiling with strict `<8 s` acceptance, no retry and immediate rollback on any miss. The reviewed source change is local-only at this evidence point; it has not yet been deployed or live-proven, and it does not approve production.

### Production customer-journey ledger foundation

- A private recovery copy named `Spartan Leads — pre-journey-ledger backup 2026-08-16` was created before the workbook change. Its private file ID is intentionally not stored in the repository.
- The reviewed Apps Script Head code was saved without updating the public web-app deployment. The active production deployment remains Version `14`, with the same deployment ID, public `/exec` URL and handler contracts.
- The read-only preflight reported both `Identity Links` and `Journey Events` missing, the configured `spartan leads` tab valid, zero lead-tab writes and zero journey rows appended.
- `setupJourneyLedgerSheets()` created exactly those two tabs. `Identity Links` has 15 reviewed headers; `Journey Events` has 28. Both contain zero data rows, freeze and bold row 1, and use plain-text formatting for identifiers.
- A post-setup diagnosis returned `ready: true` for both tabs. A second setup returned two verified tabs with zero creations, zero header writes, zero formatting changes, zero protection changes, zero lead-tab writes and zero appended events.
- The existing `spartan leads` view still showed 41 columns and row 247 after setup. Owner-alert diagnosis remained operational with one permanent trigger and no pending, attempting or failed alert. Public Apps Script and Worker health remained unchanged.
- This production foundation remains schema only. No sandbox identity, event, redemption, refund or credential was written to the production workbook. Production event entry remains disabled pending the controlled owner canary and the remaining activation gates.

### Meta privacy setting still to verify

- A fresh attempt to inspect Events Manager redirected to Facebook login, so automatic advanced matching and automatic form-event collection were not verified in this session.
- Before production form testing, confirm those account-side features are off or deliberately governed and disclosed. The repository itself does not send form values to Meta.

## Intentionally not changed

- Google Business Profile name, category set, address, phone, hours, service area and menu were not changed in this SEO-linking pass.
- No historic contact was imported or messaged.
- No Meta, TikTok or Google advertising account was linked or activated.
- Facebook, Instagram and TikTok bio links back to the canonical website were not changed in this pass; use the tagged URLs in `SEO-SOCIAL-PLAYBOOK.md` after the release is live.
- No source files or backend code were deployed by these account changes.
