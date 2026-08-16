# Spartan marketing measurement dictionary

Last reviewed: August 16, 2026

This document defines the customer journeys, milestones, identifiers, KPIs, cohorts, provisional alerts and source-of-truth boundaries for the marketing portfolio. It prevents website clicks, replayable URLs and unmatched transactions from being reported as completed customer outcomes.

All future implementations should use these definitions or record a dated decision explaining a change.

## Measurement objective

Answer five business questions without creating another owner job:

1. Which sources create first-time customers who actually redeem?
2. How quickly and how often do first-time customers return?
3. Do referred customers outperform non-referral customers after reward cost?
4. Which subscribers, content and campaigns produce store or home-product action?
5. How many people become verified home-product customers or VIP members and reorder independently?

## Source-of-truth hierarchy

| Fact | Authoritative source | Supporting source | Must not be reported as proof |
| --- | --- | --- | --- |
| Website coupon claim | Server-confirmed Sheet/Apps Script record | Worker response | Button click, modal open or Meta Lead alone |
| Website email-permission evidence | Sheet consent row with language/version, source and timestamp | Apps Script/Worker result | Email field presence or DOI request alone |
| Current email send eligibility | Matching permission evidence **and** active dedicated Brevo-list membership **and** no current unsubscribe/suppression | Brevo webhook/export | Replayable confirmation URL, prior consent row or email open |
| Prepared-drink redemption/order | Square paid transaction and applied offer/customer identifier | Staff reconciliation ledger | Directions, call or claimed coupon |
| Return purchase | Later paid Square transaction linked to the same customer | Loyalty/redemption ledger | Website revisit alone |
| Referral conversion | Verified referral code tied to friend's paid first visit | Self-reported discovery source | Share click, referral landing or claim alone |
| Reward earned/redeemed | Append-only reward ledger plus Square redemption | Customer message | Referral form or social post |
| Content interest | Brevo contact-specific profile response | Versioned research record | Email open/click inference |
| Home-product intent | Anonymous website outbound-click event | UTM/link log | Completed signup/order |
| Wellness Rewards/VIP/order completion | Authenticated MyHerbalife/BizWorks report | Exact permitted provider-ID match | Storefront click or public return URL |
| Traffic/source | GA4 cleaned anonymous event plus UTMs/referrer | Self-reported source | Raw PageView count without deduplication/context |

## Parallel customer journeys

People may participate in more than one journey at the same time.

```text
Local visit
Discover → Request offer → Redeem → Second purchase → Regular customer/referrer

Subscriber
Request updates → Confirm email → Share interests → Receive useful update → Take store/home action

At home
View products → Visit provider storefront → Verified account/order → Verified VIP/reorder
```

No system should force a current customer to look like a new coupon claimant merely because that path is easiest to track.

## Identity model

### Principles

- Assign a random internal `contact_id`; never expose it to GA4, Meta or public URLs.
- Keep raw name/email/phone in the approved operational systems. A future event ledger should prefer provider IDs or keyed lookup digests rather than duplicate raw contact fields.
- Normalize email and phone server-side. Match in this order: exact provider ID; both normalized email and phone agree; one unique and unambiguous normalized identifier; otherwise send the conflict to an exception queue. Store `match_method`, `match_confidence`, `matched_at` and manual correction history. Never match name alone.
- Keep `submission_touch_*`, HTTP referrer, self-reported discovery and verified referral as separate facts. Current code records the touch present at submission; `first_touch_*` and `last_touch_*` remain planned until a reviewed persistence model exists.
- Use a unique, non-sequential referral code. Do not encode a phone, email, Sheet row or customer number.
- Referral attribution becomes immutable when a valid friend claim is accepted, subject to fraud/support correction with an audit entry.
- Do not fuzzy-match MyHerbalife records. Unmatched outcomes remain visible for review.

### Provider identity links

| System | Candidate identifier | Status |
| --- | --- | --- |
| Website/Sheet | `submission_id`, coupon code, normalized email/phone | Available now |
| Brevo | Brevo contact ID plus normalized email | Available after authenticated integration/reporting |
| Square | Square `customer_id`, paid order ID, offer/referral code | Operational procedure/API validation required |
| MyHerbalife/BizWorks | Provider customer/member/order ID | Exact report/export fields unverified |
| GA4 | Anonymous session/client measurement only | Never use as customer identity |

## Event model

Use append-only events and derive current status. Do not repeatedly overwrite one lifecycle-stage cell and lose history.

Every first-party event should have:

- `event_id`
- `source_event_id`
- `idempotency_key`
- `event_type`
- `schema_version`
- `event_status`
- `occurred_at`
- `received_at`
- `contact_id` when identified
- `source_system`
- `recorded_by` and manual/provider source
- `campaign_id` when applicable
- `referral_id` when applicable
- `reversal_of_event_id` when applicable
- `amount_minor` and ISO currency when applicable
- versioned, allowlisted metadata only

Store timestamps in UTC and preserve the provider/source timestamp. Enforce uniqueness on `(source_system, source_event_id)`, not `(contact_id, event_type)`, because contacts may resubscribe, purchase repeatedly, receive reversals or correct an identity link.

### Core first-party events

| Normalized event/milestone | Implemented/source event | Completion rule | Status |
| --- | --- | --- | --- |
| `landing_viewed` | `page_view` | Anonymous page view after URL cleanup | GA4 available |
| `coupon_opened` | `coupon_open` | Offer dialog opened | GA4 available |
| `coupon_submit_attempted` | `coupon_submit` | Browser submits offer form; not proof of server acceptance | GA4 available |
| `coupon_claim_confirmed` | `coupon_confirmed` | Newly saved server-authenticated claim with `coupon_result=success`; duplicate/remembered retrieval does not qualify | Available |
| `coupon_existing_retrieved` | None | Existing/duplicate/remembered coupon shown without a new claim | Planned only if needed |
| `discovery_question_offered` | None | Optional question successfully rendered after an eligible new claim | Planned |
| `discovery_source_submitted` | None | Optional source answer stored once/question version | Planned |
| `email_doi_requested` | `email_doi_requested` | Brevo accepts DOI request | Available; not confirmation |
| `standalone_email_signup_submitted` | `email_signup_submit` | Browser submits dedicated Updates form | GA4 available; one of two DOI entry routes |
| `email_consent_request_attempted` | Server form record/source | Versioned request counted by `form_id` for standalone versus coupon-bundled routes | Planned normalized event |
| `email_confirmation_returned` | `email_confirmation_return` | Replayable provider redirect returns to site | Available; directional only |
| `email_subscription_confirmed` | Brevo list/webhook event | Matching recorded website email-permission evidence **and** active dedicated-list membership **and** no unsubscribe/suppression | Reconciliation/webhook planned |
| `content_interest_opportunity_delivered` | Brevo delivery event | Unique confirmed contact receives the profile-update opportunity | Planned |
| `content_interests_submitted` | Brevo current attribute plus optional first-party history event | Contact-specific optional poll saved | Planned |
| `order_completed` | Square paid order | Completed, net-positive, non-refunded paid order linked to contact | Reliable customer join required |
| `order_refunded` | Square refund | Provider confirms partial/full refund | Reliable customer join required |
| `coupon_redeemed` | Derived from Square order/discount | Paid order shows qualifying website-offer redemption | Reliable customer join required |
| `redemption_reversed` | Derived from refund/void | Prior redemption no longer qualifies | Reliable customer join required |
| `first_purchase_completed` | Derived from valid orders | Earliest verified historical paid visit after prior-history check | Reliable customer join required |
| `repeat_purchase_completed` | Derived from valid orders | Later qualifying visit after sessionization | Reliable customer join required |
| `identity_linked` | Provider/manual link event | Two identities linked under reviewed match rules | Planned |
| `identity_merge_corrected` | Manual correction event | Incorrect identity link is reversed/corrected | Planned |
| `referral_invite_created` | None | Unique non-sequential referral created for eligible customer | Planned pilot |
| `referral_landing_recorded` | None | Bot-filtered unique landing with valid referral | Planned pilot; not conversion |
| `referred_coupon_claimed` | None | Eligible new claim locked to referral | Planned pilot |
| `referred_first_purchase_completed` | Derived Square milestone | Referred customer completes qualifying paid first visit | Planned pilot |
| `reward_earned` | Reward ledger entry | Deterministic rules accept qualifying outcome | Planned pilot |
| `reward_redeemed` | Reward/Square ledger entry | Store confirms reward use | Planned pilot |
| `reward_expired` | Reward ledger entry | Reward passes stated expiry unused | Planned pilot |
| `reward_reversed` | Reward ledger counter-event | Prior earn/redemption is invalidated; history retained | Planned pilot |
| `games_campaign_viewed` | None | Spartan Games campaign page/section viewed | Planned |
| `games_entry_submitted` | None | Valid moderated idea submitted | Planned |
| `games_vote_submitted` | None | Valid vote recorded with duplicate-control status | Planned |
| `games_results_viewed` | None | Aggregate campaign result viewed | Planned |
| `home_products_viewed` | `home_products_view` | Anonymous shipped-product page view | GA4 available; intent only |
| `home_delivery_clicked` | `home_delivery_click` | Anonymous exit to Shop All | GA4 available; intent only |
| `member_savings_clicked` | `member_savings_click` | Anonymous exit to Wellness Rewards/VIP | GA4 available; intent only |
| `wellness_account_completed` | Authenticated provider report | Provider confirms account | Report fields unverified |
| `vip_signup_completed` | Authenticated provider report | Provider confirms VIP | Report fields unverified |
| `home_order_completed` | Authenticated provider report | Provider confirms first order | Report fields unverified |
| `home_reorder_completed` | Authenticated provider report | Provider confirms later order | Report fields unverified |
| `email_unsubscribed` / `email_suppressed` / `email_bounced` | Brevo state/events | Current state removes send eligibility as applicable | Available/reconciliation planned |

GA4 may receive anonymous action names and campaign dimensions. It must not receive customer IDs, coupon/referral codes, provider IDs, content-interest answers or discovery answers.

## Lifecycle milestone timestamps

Derive from valid raw events; do not manually guess:

- `first_identified_at`
- `offer_requested_at`
- `coupon_redeemed_at`
- `first_purchase_at`
- `second_purchase_at`
- `last_purchase_at`
- `email_confirmed_at`
- `interest_last_updated_at`
- `referral_link_generated_at`
- `first_referral_share_action_at` (intent only; it does not prove a post was published)
- `first_referred_claim_at`
- `first_referred_redemption_at`
- `wellness_account_verified_at`
- `vip_verified_at`
- `home_first_order_at`
- `home_first_reorder_at`

When Square linkage is incomplete, report `no linked purchase recorded`; do not claim the person did not return.

Anonymous home-product views/clicks stay aggregate under the current privacy design and do not populate contact milestones.

### Qualifying order and visit grain

- A qualifying local order is completed, net-positive after discount, non-voided and not fully refunded, at the Spartan location, with a reliable customer/order link.
- Sessionize linked orders: multiple orders for the same customer/location within four hours count as one visit unless a reviewed correction proves separate visits. This prevents split tickets from creating a false repeat visit.
- A website-offer redemption proves the offer was redeemed; it does not by itself prove the person had no prior Square purchase. Use `first-ever purchase` only after available Square history is checked.
- Report Square match coverage beside every customer-level redemption/return KPI. Unmatched orders remain outside those calculations and in an exception count.

## Primary KPIs

### 1. Website-offer claim-to-redemption rate

```text
unique valid new website-offer claimants with a verified qualifying offer redemption within the same selected window
÷ valid new website-offer claims old enough for the selected window
```

Default reporting windows: 7, 14 and 30 days. Never include a recent claim in a mature 30-day denominator.

### 2. Thirty-day repeat rate

```text
website-offer redeemers with a later qualifying visit within 30 days
÷ website-offer redeemers old enough for a complete 30-day window
```

Refunded/reversed transactions do not qualify.

### 3. Referred-customer quality and value

Report referred and non-referral cohorts on:

- claim-to-redemption rate
- 30-day repeat rate
- 60/90-day visits and revenue
- median time to first and second purchase
- reward cost
- observed attributable contribution after reward and operating cost

Observed attributable contribution is net collected revenue excluding tax, tips and refunds, minus estimated COGS, reward value, software expense and valued owner/staff time. Do not call it incremental unless a randomized holdout or other credible comparison design exists. Referral customers are self-selected, so cohort differences do not prove causation.

### Conditional strategic KPI — verified independent-home outcomes

Report two separate series now: anonymous `home_delivery_click`/`member_savings_click` counts and authenticated provider account/VIP/order counts. A click-to-outcome rate is unavailable until Herbalife supports an approved campaign/customer link or Spartan establishes a lawful exact identity join. Authenticated reporting access alone proves outcomes, not which anonymous website click produced them.

## Driver metrics

| Driver | Formula/definition |
| --- | --- |
| Browser coupon funnel | Directional unique-session/user progression across deployed `coupon_open` → `coupon_submit` → `coupon_confirmed`; analytics blocking and cross-source joins prevent contact-level exactness |
| Server coupon outcomes | Authoritative new-success, duplicate/existing, filtered and error counts from Worker/Apps Script, reported separately from browser analytics |
| Median claim-to-redemption | Median time from confirmed claim to linked paid redemption |
| DOI request rate | Brevo-accepted DOI requests ÷ server-recorded `email_consent_request_attempted`, deduplicated by contact and split by standalone Updates form versus coupon-bundled consent before any combined rate |
| DOI confirmation rate | Subset of mature eligible DOI-request contacts who became active on the dedicated list within seven days ÷ unique contacts whose latest eligible DOI request has a mature seven-day window |
| Interest research completion | Unique valid responses ÷ unique confirmed contacts whose welcome/profile email delivery containing the opportunity was confirmed; delivery is not proof the question was read |
| Discovery response | Stored optional source answers ÷ eligible new claims with a recorded `discovery_question_offered` event; exclude duplicate/existing claims |
| Referral landing-to-claim | Valid referred claims ÷ bot-filtered unique referral sessions; reloads are not new prospects |
| Referral claim-to-redemption | Verified referred qualifying redemptions within the selected 7/14/30-day window ÷ valid referred claims old enough for that same window |
| Reward redemption | Redeemed rewards ÷ issued rewards old enough for the selected window |
| First-to-second-visit time | Median and 75th percentile days between first and second qualifying sessionized visit |
| Anonymous home intent | Separate `home_delivery_click` and `member_savings_click` counts by campaign/source |
| Verified home outcomes | Separate authenticated provider account, VIP, first-order and reorder counts; no click conversion rate until an approved join exists |
| Owner burden | Minutes/week spent preparing, reconciling, approving and handling exceptions |

Email opens are not a primary KPI because privacy/proxy behavior can distort them. Prefer confirmed list state, clicks and downstream actions.

## Cohorts

Minimum acquisition cohorts:

1. Verified personal referral code.
2. Self-reported friend/family without a referral code.
3. Google Search.
4. Google Maps/Business Profile.
5. Facebook.
6. Instagram.
7. TikTok.
8. Drove by/nearby.
9. Community event/local group.
10. Observed direct/non-referral.
11. Unknown/unclassified.

Keep observed UTM/referrer and reported discovery columns separate. A customer who reports a friend but arrives through Google is not an error; it may show how word of mouth and search reinforce each other.

For referral comparisons, use verified referral code, self-reported word of mouth without code, observed non-referral acquisition and unknown as four separate cohorts. Never place unknown records in the non-referral comparison.

## Campaign and content registry

Every planned social/email/GBP campaign should have one registry row before publication:

- `campaign_id` and `content_id`
- platform and owned profile
- native post ID/permalink after publication
- content pillar and format
- planned/published timestamp
- destination and complete UTM values
- status, approval owner and source-asset version
- owner minutes and direct cost
- predeclared primary outcome, driver metrics and guardrails

For each content item, report menu/call/directions/coupon actions, confirmed claims, opt-ins and home-product actions. Add redemption/repeat only after a reliable Project 2 join. Reach, views, likes, saves, shares and comments are diagnostics; they do not prove store visits or SEO ranking improvement.

### Social-spike response

Define a spike before it happens, provisionally more than twice the trailing 28-day median views **and** meaningful saves/shares for the platform. Within 24 hours of a qualifying spike, the owner may approve a pinned/tagged website CTA where allowed, Story reshare, related Google Business Profile post and one follow-up variant. Measure branded/direct/tagged traffic and business actions. Describe the SEO effect as indirect discovery and brand-demand support, not transferred ranking authority.

### Spartan Games campaign contract

Store `campaign_id`, `campaign_version`, phase, `entry_id`, source and validity/duplicate/moderation status for entries/votes. Browser storage, opaque tokens and rate limits reduce duplicates but do not prove one vote per person unless identity is intentionally collected. The first pilot uses an ingredient allowlist, owner feasibility/claim review, manual moderation, no photo upload and appropriate adult/guardian/UGC permission rules.

Before launch, choose one primary outcome, one or two drivers and one or two guardrails. Default primary outcome is qualified store action or verified featured-drink purchase only when Square linkage exists; drivers may be valid entries/votes and tagged actions; guardrails may be duplicate/rejection rate, owner minutes, opt-outs/complaints and inventory waste. Record the baseline dates before launch so the result cannot be selected after the fact.

## Bottleneck analysis

For each transition report:

- eligible count
- completed count and rate
- median and 75th-percentile time to next milestone
- count still waiting
- match/data-quality rate
- acquisition/referral cohort
- estimated value of closing the gap

Rank bottlenecks using this decision frame:

```text
eligible volume × unconverted share × estimated gross profit × addressability/confidence
```

Do not prioritize a visually large drop when the denominator is tiny, the cohort is immature or the next action is not addressable.

## Provisional automation and alert rules

These are starting hypotheses, not final targets.

Every customer-facing automation requires current consent for the channel used, a send-time suppression check and reliable identity linkage; the rules below never independently create contact permission.

### Customer automations

- Activate purchase-based messages only when eligible Square transactions have at least 90% customer/milestone match coverage during the reviewed baseline and the individual has no unresolved identity exception; adjust this provisional threshold only with a dated data-quality decision.
- No linked redemption 72 hours after a confirmed request: at most one reminder, only with active email consent and reliable linkage.
- First purchaser with no second linked visit after 10–14 days: at most one useful return message.
- Established customer with at least four qualifying visits/three intervals: define at risk after `1.5 × personal median visit interval`, with a 14-day floor and 45-day cap. Use a matured cohort rule when there is not enough personal history.
- Reward expiring in seven days: one reminder if channel consent is active.
- At least 60 days between win-back automations.

Do not turn these conditions into individual owner alerts.

### Immediate owner/system alerts

| Condition | Initial trigger | Severity/cooldown |
| --- | --- | --- |
| Cloudflare Worker route health | Two failed five-minute checks | High; alert once, 60-minute cooldown until recovered |
| Apps Script/configuration health | Two failed five-minute checks or version/config mismatch | High; alert once, 60-minute cooldown |
| Sheet availability/write queue | Oldest pending item exceeds 30 minutes or queue exceeds 25 | High; repeat only after 60 minutes if unresolved |
| Brevo delivery/API health | Three consecutive provider failures or ≥10% failure over one hour with at least 10 attempts | High; 60-minute cooldown |
| Webhook security | Three invalid signature/replay events in 15 minutes | Critical; immediate then 60-minute cooldown |
| Reward ledger invariant | Duplicate earn, one order linked twice, negative balance or invalid reversal | Critical; immediate and pause reward processing |
| Scheduled reconciliation | Expected import/run missing by 10:00 a.m. local on the next scheduled day | High; once per missed run |

Monitor Worker routing, Apps Script/configuration, Sheet availability, Brevo delivery and any controlled end-to-end canary separately. Public `/api/forms/health` alone does not prove the Sheet write or Brevo path. Run synthetic write/send canaries only with a dedicated test identity/environment excluded from customer metrics; otherwise retain periodic labeled human end-to-end checks.

### Weekly owner digest

- Three primary KPIs.
- Mature funnel conversion and time-to-next-stage.
- Unmatched Square/MyHerbalife records.
- Referral liability and fraud/duplicate exceptions.
- Brevo delivery/suppression issues.
- Owner minutes and any automation that should be paused.

## Provisional decision gates

- Investigate a confirmed-claim decline greater than 20% versus comparable prior weekdays for seven days before changing the design.
- If DOI confirmation is below 40% after at least 20 mature requests, treat it as a diagnostic—not a performance target—and inspect sender recognition/inbox instructions before buying traffic.
- Produce an operational interest/discovery status after 30 days. Do not make content decisions until at least 50 valid responses; always show counts, uncertainty and selection bias.
- Treat 20 matured referred claims as a workflow/abuse/reconciliation smoke test, not profitability proof. Scale only after a larger matured cohort or multiple pilot periods.
- Pause/refine referrals when observed attributable contribution after reward, COGS, software and valued labor does not clear the agreed threshold. Reserve `incremental` for a documented holdout or credible experiment.
- Retain a paid social tool only if it saves at least 30 minutes/week or measurably improves attributable actions.
- Consider a managed event ledger only when manual joins take more than 60 minutes/week, produce repeated errors or prevent an approved automation.

Targets should be reset after four to eight weeks of comparable production data. Record the date, baseline and reason whenever a threshold changes.

## Guardrails

- Zero recurring marketing sends without current channel-specific consent.
- Coupon, purchase, referral, poll and reward participation remain available without marketing signup.
- Interest answers never override an unsubscribe or suppression.
- Historic unknown-consent contacts remain quarantined.
- Referral friends provide their own information.
- No reward for a review, regardless of online or physical presentation.
- Do not activate a rewarded public-share task until the retained Herbalife response confirms the public/private channel design. Any approved share must omit numeric/free language, use the approved destination, disclose the material connection clearly and satisfy platform promotion/endorsement rules.
- No diagnosis, medication/GLP-1 use, weight, income or individualized health-goal collection.
- No PII, provider IDs or interest/referral details in GA4/Meta.
- Query consent/suppression at send time, not only when an automation was scheduled.
- Avoid retaining raw webhook payloads after normalized processing.
- Establish data retention/deletion periods before a persistent event ledger launches.

## Retention, access and recovery specification

Finalize every `[REVIEW/FILL]` item before a persistent event ledger launches. Do not invent a legal retention period merely to complete the table.

| Data class | Purpose/form | Retention decision | Deletion/anonymization | Access and recovery |
| --- | --- | --- | --- | --- |
| Consent/suppression events | Normalized append-only proof; raw language/version/source retained | Active relationship plus post-suppression audit period `[REVIEW/FILL]` | Never erase the minimum suppression proof needed to prevent resending; define lawful deletion path | Owner/provider admins only; encrypted export and restore test |
| Coupon/redemption/order links | Normalized IDs, timestamps, amount/currency; no unnecessary raw payment data | `[REVIEW/FILL]` based on operations, tax/receipt and dispute needs | Delete/anonymize contact link when eligible while preserving aggregate/audit needs | Owner and bounded integration account; source reconciliation export |
| Referral/reward ledger | Append-only earn/redeem/expire/reverse events | `[REVIEW/FILL]` after reward liability/dispute window | Counter-events, never destructive history edits during active window | Owner; scheduled backup and restore test |
| Interest/discovery research | Brevo current state plus aggregate snapshots; optional first-party history only if approved | `[REVIEW/FILL]`, minimized for research purpose | Remove contact linkage or delete when no longer useful; preserve only aggregate counts where possible | Owner/marketing operator; versioned export |
| Raw webhook/import payloads | Temporary troubleshooting/input normalization | Provisional maximum seven days unless provider/security investigation requires a documented hold | Delete after reconciliation; retain normalized event and source ID | Integration service plus owner for incidents; encrypted transient storage |
| Normalized journey events | Pseudonymous event ledger | `[REVIEW/FILL]` before Stage 2 | Anonymize/delete according to approved request and audit exceptions | Owner; database backup, point-in-time restore and export test |
| GA4 anonymous events | Traffic/action analysis | Current configured event/user retention applies; reverify before change | Provider controls and deletion process | Owner/analytics admins |
| Test/staging records | Dedicated noncustomer identities and environments | Provisional 30 days | Automated deletion with test-run evidence retained separately | Technical owner; never mix into production KPIs |

Document environment separation, secret ownership/rotation, least-privilege roles, backup frequency, successful restore-test date, export format and an identity-correction audit trail before production Stage 2. Use owner-only administration initially.

## Staged technical architecture

### Stage 1 — current tools plus a controlled ledger

- Static site on GitHub Pages.
- Cloudflare routing/form boundary.
- Apps Script/Google Sheet for coupon and consent audit.
- Brevo for DOI, delivery, segmentation and suppression.
- Square for prepared-drink order/redemption truth.
- GA4 for anonymous traffic/actions.
- Manual append-only redemption/referral/reward ledger during pilots.
- Monthly authenticated MyHerbalife/BizWorks import if supported.

### Stage 2 — lightweight first-party event store

Trigger only after Stage 1 proves value and exposes a real limit. Compare:

- Cloudflare D1 behind a separate Journey Worker: lowest friction with current Cloudflare infrastructure and likely lowest pilot cost.
- Supabase/managed PostgreSQL: stronger conventional relational tooling and a cleaner path if the system later becomes reusable across businesses.

Do not select solely on novelty. Evaluate data portability, provider adapters, backups, observability, privacy, authentication, monthly cost and non-full-time maintenance. Keep the Sheet as the consent/coupon audit until a controlled migration is independently reconciled.

Potential normalized tables:

- `contacts`
- `provider_identities`
- `consent_events`
- `content_interest_responses`
- `coupon_claims`
- `journey_events`
- `referrals`
- `reward_ledger`
- `orders`
- `campaigns`
- `webhook_receipts`
- `alert_state`

### Stage 3 — provider automation

- Read-only Square webhooks/API with signature and idempotency controls.
- Brevo confirmation/unsubscribe webhooks.
- MyHerbalife import automation only if officially supported and permitted.
- Owner dashboard and weekly digest.

Do not build custom email/SMS delivery, payment, storefront shipping, multi-tenancy or a large admin system.

## Data-quality acceptance tests

- `event_id` and `(source_system, source_event_id)` are unique; required fields and event/status enums validate.
- No orphan contact, referral, order, reward or reversal foreign key exists.
- No future timestamp exceeds the approved provider-clock tolerance.
- Each provider import reconciles input/output row counts and reports missing/late source data.
- Exact retry never produces a duplicate claim, consent event, referral reward or notification.
- Refund/reversal produces an auditable reversal rather than deleting history.
- Same-session split orders cannot create a repeat visit.
- Unsubscribe between scheduling and send prevents the message.
- Invalid/self/duplicate referral cannot earn value.
- One Square order cannot satisfy two referral rewards.
- A contact matched by conflicting provider identifiers goes to an exception queue.
- Identity merge/correction history is retained and affected derived milestones are recalculated.
- A recent cohort is excluded from mature-window KPI denominators.
- Outbound storefront click can never populate a completed account/VIP/order event.
- A referral URL is resolved and cleaned before GA4 initializes; `page_location`, referrer and event payloads never contain the referral code or another internal identifier.
- No event payload sent to GA4/Meta contains PII or internal/provider identifiers.
- Match coverage is displayed beside every customer-level KPI.
- Owner can pause each automation without changing code or losing history.

## Reporting cadence

- **Daily automated:** technical health and queue failures only.
- **Weekly:** concise journey scorecard, bottlenecks, exceptions and owner time.
- **Monthly:** acquisition/referral cohorts, repeat behavior, Brevo performance, home-product reconciliation and project keep/change/stop decisions.
- **Quarterly:** KPI/threshold review, retention/privacy check and vendor/tool cost review.

The dashboard should optimize decisions, not create vanity reporting. If a metric does not change a marketing, operations or product decision, remove it.
