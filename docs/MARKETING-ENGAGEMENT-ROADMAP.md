# Spartan Nutrition marketing and engagement portfolio

Last reviewed: August 16, 2026

This is the canonical portfolio for marketing, customer journeys, referrals, rewards, lifecycle messaging, social media, Spartan Games, local reputation and the shipped-product handoff. It records decisions, unimplemented ideas, project boundaries and the order in which work should proceed.

Nothing described as **planned**, **pilot**, **provisional** or **later** is live or approved customer-facing language merely because it appears here.

## Business outcome

Build a profitable, low-maintenance system that helps people discover Spartan, visit the Bixby store, return, refer friends, opt into useful updates and eventually order home products independently. The system should feel local, useful and fun without creating a coaching obligation, medical-news operation or disguised recruiting funnel.

The operating model has three connected layers:

```text
Social, local search and referrals
                |
                v
Always-on customer journey and measurement
                ^
                |
Optional Spartan Games and special campaigns
```

The always-on journey must keep working when a social tool, reward pilot or Spartan Games campaign is paused.

## Decisions made

- Content-interest questions are optional market research. They do not limit the general Spartan Updates a person may receive.
- Ask people to choose up to three interests so results reveal priorities. Allow Skip, preselect nothing and never require an answer for a coupon or subscription.
- Include `Evidence-based research news` as an interest now. Do not promise that a newsletter will be created; demand will determine whether that content is worth producing.
- Keep email and SMS consent separate. Interest, referral, review, social interaction or purchase activity never creates either permission.
- Do not reward Google reviews. A flyer, QR code, punch card or in-store request does not change Google's prohibition on incentivized reviews.
- Keep Spartan store rewards separate from Herbalife Wellness Rewards/VIP. Connect the journeys, but do not rebuild Herbalife's native loyalty and referral system.
- Do not send the owner a task whenever a customer has not returned in seven days. Use one permissioned 10–14-day first-return automation after a verified first redemption, a baseline-based lapse rule for established customers and one aggregate weekly exception report.
- Use ChatGPT for research, creative preparation and analysis, not unsupervised publishing or autonomous health/customer replies.
- Begin with a measured manual referral pilot before building a custom rewards platform.
- Preserve the current website, form, Brevo, Google Sheet, GA4 and Cloudflare foundation unless a project explicitly requires a bounded change.
- Use the owner's accepted offer/reward channel interpretation as the operating assumption: a customer-initiated website request begins an individualized invitation journey, and Spartan may operate its own customer rewards. Optional wording review may refine future copy, but it does not block journey measurement, referral design or the current project sequence.

## Offer and reward operating assumption — owner accepted, non-blocking

The owner has directed the portfolio to proceed on this operating basis:

- Public website language may invite a first-time customer or current customer to begin a journey.
- After the customer clicks or submits, the resulting coupon, message or next step is treated as an individualized invitation.
- Spartan may operate its own deterministic customer rewards and referral journey.
- This owner decision governs planning and implementation; it is not presented here as an independent legal conclusion.
- Any later optional wording review is advisory and may produce a bounded copy change, but it is not a portfolio gate unless the owner changes this decision or a specific platform/account issue arises.

The separate no-incentivized-review rule, clear referral disclosures, consent boundaries and measurement controls remain in force. Those are operational safeguards, not a reason to keep re-opening this decision.

## Current confirmed foundation

- The website records server-confirmed first-visit claims and separate, auditable email permission in Google Sheets.
- Brevo handles double opt-in, unsubscribe and suppression. Confirmed Brevo list membership is the subscriber source of truth.
- GA4 measures cleaned anonymous website actions and campaign attribution. The replayable Brevo return URL is directional, not proof of list membership.
- The current GA4 implementation does not provide an apples-to-apples pre-rebuild visitor baseline. Make forward decisions from comparable post-launch periods and business outcomes rather than raw legacy-versus-new page-view totals.
- The live confirmation return card says `You’re confirmed!` and clearly indicates that the Spartan Updates subscription is confirmed.
- Brevo has the live `CONTENT_INTERESTS` profile-update form and an active two-minute welcome automation for new confirmed list members. Re-entry is off.
- Owner alerts are working: one permanent 15-minute Apps Script trigger sends counts-only submission alerts. Production QA confirmed that an eligible new claim produced one alert and its discovery update produced no second alert.
- Search Console, GA4, Google Business Profile, Cloudflare redirects, social links, the menu pages and the shipped-product handoff are deployed.
- The website can measure outbound home-product and VIP interest. It cannot currently prove a completed Herbalife signup, VIP enrollment or shipped order.
- Square is the operational source for prepared-drink sales and redemptions, but there is no reliable automated customer-level join between Square and website submissions yet.
- Apps Script Version `14`, internal contract `spartan-discovery-contract-v1-2026-08-16` and Worker public contract `spartan-discovery-v1-2026-08-16` are live. A new claimant may answer one optional ten-choice discovery question; the first valid answer updates the same claim row and wins on retry. The system does not create a second lead, change consent or create another owner alert.
- The active website/data contract supports `coupon_claim`, `email_signup` and `discovery_source`. Referral codes, rewards and purchase/lifecycle milestones remain planned.

## Portfolio priority

Priority is based on expected business value, time to learning, build/maintenance cost, owner involvement and dependency risk. Scores are provisional decision aids, not measured performance.

| Rank/status | Project | Planning score | Expected value | Effort | Maintenance | Owner burden after setup | Timing |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| **Live** | **Project 1 — Customer insight and confirmation foundation** | 93 | High | Complete | Low | Very low | Operate and measure |
| **1 — Next** | **Project 2 — Journey measurement and identity foundation** | 91 | Very high | Medium | Low-medium | Low | Start now; implement in stages |
| 2 | Project 3 — Referral and Spartan Rewards MVP | 88 | Very high potential | Medium | Medium during pilot | Low after proof | After Project 2 can verify redemption |
| 3 | Project 4 — Lifecycle email and re-engagement | 84 | High | Medium | Low | Very low | Welcome is live; purchase messages follow Project 2 |
| 4 | Project 5 — Social content and engagement operating system | 82 | High | Low initially | Medium | 75–100 min/week initially | May begin in parallel at no added cost |
| 5 | Project 6 — Local reviews and reputation loop | 79 | High | Low | Low | Low | May begin in parallel, no incentives |
| 6 | Project 7 — Home-delivery and Wellness Rewards/VIP handoff | 76 | Medium-high | Medium | Low | Low | Improve after completion reporting is verified |
| 7 | Project 8 — Spartan Games campaign framework | 68 | Medium/experimental | Low-medium | Medium while active | 45–75 min/week | After journey tracking works |
| Later | SMS, managed data hub and reusable product | — | Unknown until evidence | High | Medium-high | Varies | Explicit later-stage gates |

Project 1 is complete and live. Project 2 is the active next project because Projects 3, 4, 7 and 8 depend on trustworthy redemption, return and identity milestones. Projects 5 and 6 may run in parallel because they can use current tracked links without changing the customer database.

### Operating register

| Project | Status | Business owner | Dependency/blocker | Next action | Target release | One-time/monthly cost | Owner-time ceiling | Stop gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Insight/confirmation | **Live** | Owner with technical support | No release blocker; first 30-day learning window is in progress | Monitor interest/source response and form health | Live August 16, 2026 | Current tools | ~15 min/month | Roll back any question that reduces claim/signup completion |
| 2 Measurement/identity | **Next** | Owner with technical support | Reliable Square identifier and redemption procedure | Define Square SOP, baseline and manual reconciliation ledger | Staged implementation starts now | Pilot `$0`; future data store TBD | ≤15 min/week | Defer automation if match coverage/owner burden fails |
| 3 Referral/Rewards MVP | Planned, not live | Owner | Project 2 redemption measurement | Finalize terms and manual 60-day pilot | After measurement gate | Reward economics TBD; software `$0` pilot | ≤30 min/week pilot | Stop for fraud, weak observed contribution or excess work |
| 4 Lifecycle email | Welcome/interest automation live; purchase lifecycle planned | Owner | Trusted redemption/return signal | Measure welcome flow; add one return message after Project 2 | Welcome live; later messages staged | Current Brevo limits; upgrades TBD | ~15 min/month | Pause on consent errors, complaints or no directional value |
| 5 Social operating system | Ready for Stage 0 | Owner | Source pack and approval routine | Run four-week native-tools baseline | Start in parallel | `$0`; paid tool only after test | 75–100 min/week initially | No paid tool without ≥30 min/week saved or better actions |
| 6 Reviews/reputation | Ready, no incentives | Owner | Current QR/link and neutral copy | Build digital/in-store request assets | Start in parallel | `$0` digital; printing TBD | ~15 min/month | Stop any selective/incentivized practice immediately |
| 7 Home/VIP handoff | Partly live; reporting blocked | Owner | Site Builder AEM issue; BizWorks fields | Verify reports and resolve cart/profile backlog | After report verification | Provider tools; support cost TBD | 5–10 min/month | Do not report clicks as completions |
| 8 Spartan Games | Concept only | Owner | Project 2 attribution; campaign review | Run no-prize research pilot | After attribution baseline | `$0–$100` pilot | 45–75 min/week while active | Do not repeat without measurable value and acceptable work |

`TBD` means the amount must be verified before approval; it is not assumed to be zero.

## Project 1 — Customer insight and confirmation foundation

**Status: complete and live as of August 16, 2026.** The release solved three separate gaps without adding another required step to the coupon or signup journey.

### Live confirmation experience

- The confirmation return card now says `You’re confirmed!` and `Your Spartan Updates subscription is confirmed.`
- It does not show the signup form as though another registration is required.
- Brevo confirmed-list membership, unsubscribe and suppression state remain the authoritative sendability controls; a GA4 return event is directional only.

### Live content-interest research

The contact-specific Brevo profile-update form asks:

> Help shape Spartan Updates. Which topics would you most enjoy seeing? Optional—choose up to three. This helps us decide what to create; it does not limit the general Spartan Updates you may receive.

Options:

1. New menus, drinks and flavors
2. Holiday and special hours
3. Spartan events, announcements and Spartan Games
4. In-store promotions and rewards
5. Mega Tea Kits, make-at-home drinks and shipped products
6. Product and nutrition education
7. Fitness and workout education
8. Free recipes, guides, tools and wellness ideas
9. Evidence-based health, nutrition and fitness research news

Rules:

- Optional and unselected by default.
- The form asks for up to three selections. Brevo does not enforce the maximum, so an extra choice is accepted rather than blocking the response.
- It is research/segmentation, not consent and not an exclusive delivery preference.
- Keep one general Spartan Updates list rather than nine lists.
- Current choices are stored in the Brevo `CONTENT_INTERESTS` multiple-choice attribute. The profile form updates the existing contact; it is not append-only history.
- Document the profile-form/question version and monthly aggregate snapshot date. If per-contact response history is later required, add a separate versioned first-party research event rather than claiming the overwritten Brevo attribute is an audit log.
- Invite people to update the answer no more than every 6–12 months.
- Do not ask whether a person uses GLP-1 medication, peptides or supplements; has a diagnosis; or wants a specific medical/weight outcome.
- If research news ranks highly, pilot one monthly evidence digest using primary research, systematic reviews or authoritative guidance, with source links, study limitations, no individualized advice and human review.
- General research content must not be translated into a disease, therapeutic or product-benefit claim. Do not connect a study to a Spartan or Herbalife product unless the exact claim is supported by the current product label or retained Herbalife-approved material. Treat health/research interests as potentially sensitive, use aggregate demand first and cover their use in the privacy notice.

The active `Spartan Updates — Welcome + Interests v1` automation begins when a new contact joins the confirmed subscriber list, waits two minutes and sends one welcome message with the contact-specific profile link. Re-entry is off. Existing subscribers were not entered retroactively.

### Live discovery-source research

After a genuinely new coupon is confirmed and already visible, the site asks:

> One quick question—how did you first hear about Spartan? Optional—your coupon is already ready.

Choices:

- Google Search
- Google Maps
- Facebook
- Instagram
- TikTok
- Other social media
- Friend or family
- Drove by / nearby
- Community event or local group
- Other

Apps Script Version `14` and the Worker contracts accept only these ten choices. The first valid answer updates four discovery fields on the same claim row and wins on retry. It does not append a lead, change the coupon or consent, call Brevo or queue an owner alert. Duplicate, existing and device-remembered claims do not receive the question. GA4 receives only the generic `discovery_source_saved` event after a first save, never the selected answer.

### Launch and QA evidence

- The Brevo profile form updated the same owner-controlled contact twice, preserved confirmed-list membership and created no duplicate.
- Two owner-only welcome-flow tests delivered successfully with DKIM, SPF and DMARC passing; unsubscribe controls remained present.
- Backend and browser validation covered allowlisted fields, exact response shapes, retries, malformed/extra-field requests, accessibility state and the rule that discovery cannot create a second lead or alert.
- One owner-controlled production QA claim created one labeled test row. Its first discovery answer updated that row; a different retry returned `already_saved` and did not overwrite it.
- The corresponding counts-only owner alert reached `sent` and arrived in Gmail. The discovery update generated no second alert.
- The live Apps Script health reports the internal discovery contract, and the Worker health reports public contract `spartan-discovery-v1-2026-08-16` while retaining the existing coupon and email routes.

### Operating follow-up

- Keep the live flow stable while Project 2 begins.
- Produce the first operational interest/source status after 30 days. Do not make content decisions until at least 50 valid responses; always show counts and selection bias.
- Report interests as responses from confirmed subscribers who received and used the profile opportunity. Report discovery answers as responses from eligible new website coupon claimants, not all visitors or store customers.
- Authenticate an `@spartandrink.com` Brevo sender later as a bounded deliverability/branding improvement; it is not a Project 2 blocker.

## Project 2 — Journey measurement and identity foundation

**Status: next active project.** Project 1 is live; the immediate need is to connect website claims to reliable Square redemption and return evidence without building a new database first.

### Business problem

The current systems can count coupon claims and anonymous website actions, but cannot truthfully measure how long an identified customer takes to redeem, return, refer someone or become a verified Wellness Rewards/VIP customer.

### Scope

Define stable identities, raw events, derived milestones, Square/provider reconciliation, data quality and the weekly scorecard. Begin with the current Sheet and a manual append-only pilot ledger; add a managed event store only after the documented trigger is met.

### Recommended journey

```text
Discovery
→ identified lead / offer request
→ first in-store redemption
→ second purchase
→ engaged repeat customer
→ qualified referrer
→ home-product interest
→ verified Wellness Rewards account
→ verified VIP enrollment
```

This is a milestone model, not a rigid one-way funnel. A current customer may subscribe before claiming, visit without a coupon or discover shipped products before a second store visit.

### Phase 1 scope

- Keep Google Sheets as the website/consent audit source.
- Define stable internal contact/customer/referral identifiers and document current match coverage.
- Establish one owner-maintained Square procedure for attaching the first-visit offer and a stable customer identifier to the qualifying transaction.
- Price and test Square Loyalty/customer profiles before building a second local points engine. Prefer the native POS workflow if it can represent the approved Spartan rules, customer linkage and audit trail at acceptable cost; keep the referral attribution and cross-system measurement logic provider-neutral. See [Square Loyalty API overview](https://developer.squareup.com/docs/loyalty-api/overview).
- Maintain a small append-only redemption/return ledger for a 30-day baseline instead of editing historical events.
- Reconcile the live Brevo confirmation, delivery, unsubscribe and suppression states needed for the weekly scorecard.
- Publish a weekly aggregate scorecard and exception list; do not ask the owner to monitor every person manually.
- Keep authenticated home-product outcome reconciliation as a later Project 2 lane after the local claim-to-redemption join works; it does not block the Square baseline.

### Immediate next deliverable

1. Write and test the Square redemption/customer-link SOP using an owner-controlled transaction.
2. Record 30 days of new claims, discovery answers, linked redemptions, second visits, unmatched records and owner minutes.
3. Publish the first weekly scorecard with denominators, match coverage and exclusions shown.
4. Decide from evidence whether the current Sheet/manual ledger is sufficient or whether a managed event store has reached its documented trigger.

The exact Phase 0 account checks, staff workflow, two-tab ledger, matching rules and acceptance gates are specified in [`SQUARE-JOURNEY-PILOT.md`](SQUARE-JOURNEY-PILOT.md).

### Phase 2 trigger

Add a lightweight first-party event store only after the manual pilot proves that cross-system joins create enough value and the Sheet becomes the actual constraint. Compare Cloudflare D1 with Supabase/managed PostgreSQL against portability, backups, observability, privacy, monthly cost and the future reusable-product direction; do not select a vendor merely because it fits the current stack. Preserve GitHub Pages and use provider adapters rather than rebuilding email, SMS, payments or fulfillment.

### Constraints and blockers

- Square transactions must consistently carry a customer ID, coupon/referral code or other reliable identifier.
- Exact Square customer/order API scope and staff workflow require validation.
- Current Square Loyalty pricing and fit for Spartan's approved reward structure are unverified.
- Exact MyHerbalife/BizWorks export fields, timing and API availability remain unverified.
- GA4/Meta cannot be the customer database and must not receive customer PII.
- Brevo is the consent/delivery/segmentation system, not the reward or transaction ledger.

### Deliverables

- Event, stage, KPI and alert dictionary in `MARKETING-MEASUREMENT-DICTIONARY.md`.
- Identity-linking and data-retention rules.
- Square redemption/customer-link SOP.
- Baseline dashboard or weekly scorecard.
- Reconciliation runbook for Sheet, Brevo, Square and MyHerbalife.
- Data-quality report for unmatched and duplicated records.

### Definition of done

- Raw source events are append-only and idempotent; lifecycle milestones are derived reproducibly from current valid events, including reversals and identity corrections.
- A test customer can move claim → redemption → second purchase → referral outcome without duplicate rewards.
- Source cohorts can be compared without putting customer identity in analytics.
- Weekly reporting shows stage conversion, time to next milestone, unmatched records and owner minutes.
- Sync or data failures alert the owner; ordinary customer inactivity triggers an approved automated message, not a manual owner task.
- The system can be rolled back without losing consent history or Square/Herbalife source records.

## Project 3 — Referral and Spartan Rewards MVP

### Business problem

Word of mouth appears to be Spartan's highest-ROI acquisition channel, but it is not measured or systematically reinforced.

### Scope

Run a deterministic 60-day pilot after Project 2 can verify a redemption. Use the owner's accepted offer/reward operating assumption for the customer journey; optional wording review may refine copy without blocking the pilot design.

```text
Existing customer receives a unique, non-sequential referral code or QR
→ customer shares the public, nonnumeric invitation with disclosure
→ friend requests the first-visit offer
→ friend redeems in store
→ referrer earns one Spartan thank-you reward
→ reward is redeemed and measured
```

The customer-facing journey should show one understandable next step at a time:

1. `Welcome reward requested`
2. `Visit Spartan and redeem`
3. `Invite a friend`
4. `Friend completed a first visit`
5. `Your Spartan reward is ready`
6. `Explore another menu, Spartan Games or products for home`

Do not display a progress step for leaving a review, granting marketing permission or buying VIP membership. Those must remain independent choices.

Rules:

- Reward only after a new friend's verified in-store redemption, never for a click or unredeemed lead.
- Friend supplies their own information. Do not let a referrer upload someone else's phone/email.
- Tell the friend the referrer may earn a Spartan reward.
- A rewarded public share must use the owner-approved destination, disclose the material connection clearly—for example, `I may earn a Spartan reward if you use my link`—and satisfy the platform's promotion/endorsement rules.
- No self-referrals, cash value, stacking or duplicate first-time customers.
- Use one reward per transaction, 60-day expiry and a provisional cap of ten earned rewards per customer/month until fraud and profitability are understood.
- Keep referral participation independent of email/SMS consent, reviews and Wellness Rewards/VIP enrollment.
- Give non-marketing-consented customers access to their referral code in store, on an eligible receipt or through a customer-initiated result page. Deliver referral messages by email/SMS only when current permission for that channel exists.
- Final reward wording/value is an owner decision to record before the pilot goes customer-facing; optional external wording review is non-blocking.
- Every qualifying prepared-drink redemption or reward must be accurately recorded in Square and any other current store record, including the amount actually paid.

### Task/reward policy

Start with one commercially meaningful task: a referred friend completes a first visit. Do not launch a large points catalog yet.

Potential later tasks, each requiring its own economics and policy check:

- Complete a second tracked visit.
- Try a new drink category.
- Participate in a future deterministic poll/feedback reward only as a separate Project 3/8 experiment with its own economics and rule review. The first Spartan Games pilot remains no-prize and offers no participation reward.
- Share a tracked public referral only with the required material-connection disclosure and the owner-approved channel design.

Never reward a Google review, a positive rating, marketing consent, health outcome or membership enrollment. Do not award value merely for a social like/comment because it is easy to game and weakly tied to revenue.

### Constraints and blockers

- Requires a reliable Square customer/order/referral link and a simple store redemption procedure.
- Reward amount, COGS, margin, fraud cap, expiry and staff procedure remain to be finalized.
- Public sharing requires the owner-approved channel, clear referral-reward disclosure and tracked destination.
- Twenty matured referred claims are only a workflow smoke test; the pilot needs more matured evidence before scaling.

### Deliverables

- Referral code/QR generation and share page.
- Public invitation copy, private offer message and material-connection disclosure.
- Eligibility, expiry, exclusions, cap, fraud and support terms.
- Manual referral/reward ledger with state transitions.
- Square redemption and reconciliation procedure plus staff quick guide.
- Referral cohort report and reward-cost/profitability model.

### Definition of done

- The owner's operating assumption and final offer/reward language are retained with the pilot record.
- Twenty or more matured referred claims complete the workflow/abuse/reconciliation smoke test; profitability/scaling waits for a larger cohort or multiple pilot periods.
- The referrer is rewarded only once after a verified qualifying redemption.
- Self-referrals, duplicates, reversals and expired rewards are handled.
- Store records reconcile to the actual amount paid and the Square/reward record.
- Referred customers can be compared with non-referral customers on redemption and 30/60-day repeat behavior.
- Continue only if observed attributable contribution—net collected revenue excluding tax/tips/refunds, less estimated COGS, reward value, software and valued owner/staff time—exceeds reward and operating cost by the agreed margin. Use `incremental` only with a documented holdout or credible experiment.

## Project 4 — Lifecycle email and re-engagement

### Business problem

Spartan needs low-maintenance repeat visits without asking the owner to manually follow every lead or customer.

### Scope

- One double-opt-in welcome automation with menu, hours/directions, social links, Mega Tea Kits/home products and the optional interest-research link.
- One unredeemed-offer reminder only when the customer consented to email and the redemption signal is trustworthy.
- One second-visit reminder 10–14 days after first redemption when no second tracked purchase exists.
- One regular-customer re-engagement rule after a baseline-defined lapse, provisionally 30–45 days.
- One monthly special-menu/update template.
- Frequency cap, quiet handling of unsubscribes/suppressions and a control group when volume permits.

Do not create an owner alert whenever someone has not returned. Send the approved automated message and show aggregate exceptions in a weekly report.

### Constraints and blockers

- Depends on Project 2's reliable redemption/return identity.
- Email only at first. SMS requires separate consent, terms, registration and provider work.
- Avoid medical, weight-loss or personalized coaching content.
- Never clear a Brevo unsubscribe or suppression based on website/Square activity.

### Deliverables

- Welcome, reminder and win-back templates.
- Automation eligibility/suppression rules.
- Frequency policy and campaign calendar.
- Conversion and unsubscribe report.

### Definition of done

- Every automation uses only eligible opted-in contacts and stops on unsubscribe/suppression.
- Test contacts enter and exit each sequence correctly.
- A randomized holdout may estimate incremental return behavior when volume permits; otherwise label pre/post or matched-cohort results directional and noncausal.
- Owner work remains limited to approving planned content and reviewing one aggregate report.
- Poor-performing or high-unsubscribe messages can be paused without developer intervention.

## Project 5 — Social content and engagement operating system

### Business problem

Social can create traffic and community, but constant drafting, posting and inbox monitoring can become another owner job.

### Scope

Create one source-backed creative/approval/reporting workflow for Facebook, Instagram, TikTok, Google Business Profile and optional Brevo campaigns. Start with native tools and ChatGPT preparation, then test one scheduler or one comment-to-DM automation only when a measured workload/demand justifies it.

### Stage 0 — no added subscription

- Create one ChatGPT project named `Spartan Nutrition Marketing` containing verified store facts, brand voice, approved claims, links, menu assets, offer/reward decisions, UTM conventions, prior results and customer/photo permission rules.
- Create a reusable Spartan Campaign Kit prompt or skill so each run produces a two-week calendar, platform-specific captions, three short-video scripts, one Google Business Profile update, an optional Brevo draft, story/poll ideas, a UTM link table, required assets and explicit approval/claim flags.
- Use Meta Business Suite for Facebook/Instagram scheduling and inbox.
- Use TikTok and Google Business Profile natively.
- Optionally test Metricool Free for 30 days as a bounded workflow test on one or two networks and no more than 20 total published posts; keep the full cross-platform cadence in native tools and keep native notifications enabled.

Recommended cadence:

- Three core content packages per week: menu discovery, local personality/customer experience, and make-at-home/engagement/store update.
- 10–15 minutes weekly capturing real drinks, owners/store activity and current menu artwork.
- 45–60 minutes reviewing and scheduling.
- About 20 minutes across the week for real comments/messages.
- Target total owner time: 75–100 minutes/week initially.

ChatGPT scheduled tasks may prepare a Monday content package, a Friday opportunity brief and a monthly performance summary when enabled. They do not replace a connected publisher or human approval. See [OpenAI scheduled tasks](https://learn.chatgpt.com/docs/automations) and [Launch campaign kit](https://learn.chatgpt.com/use-cases/launch-campaign-kit).

### Stage 1 — one paid manager only if justified

- Trial [Metricool Free](https://metricool.com/pricing/) first only as a bounded one- or two-network workflow test. Its current public plan supports one brand, up to 20 published posts/month total and 30 days of analytics; cross-network copies count against the limit, so the full three-packages-per-week cadence remains native unless a paid plan is justified. Its [inbox does not provide push/email alerts](https://help.metricool.com/inbox-manager-how-to-manage-messages-and-comments-from-metricool-s9zze), so keep native alerts enabled. See the [Free-versus-premium limits](https://help.metricool.com/main-differences-between-free-and-premium-plans-bl0v9).
- Consider Metricool Starter only if posting limits, history or reporting matter and it saves at least 30 minutes/week. Current public pricing starts around `$25/month`, subject to billing/region changes.
- [Buffer](https://support.buffer.com/article/595-features-available-on-each-buffer-plan) is an alternative, not an additional subscription. Current Essentials pricing is about `$6/channel/month`, or about `$24/month` for Facebook, Instagram, TikTok and Google Business Profile. Choose it only if its simpler workflow wins the 30-day comparison.
- Do not buy Hootsuite or Sprout Social at Spartan's current one-location/owner-operated scale; their entry cost and team features do not currently justify the return.
- Verify pricing, account eligibility and supported post types immediately before purchase; vendor plans change.

### Stage 2 — one measured comment-to-DM pilot

Use Manychat only after a 30-day baseline identifies a proven post and channel. Pilot one eligible channel, one keyword and one proven `Comment MENU` or `Comment KIT` post. The current [Essential plan](https://help.manychat.com/hc/en-us/articles/25800276116508) is approximately `$17/month` or `$14/month` annually, limited to two eligible channels and 250 active contacts before overage; account/region availability and pricing must be rechecked. It cannot cover Facebook, Instagram and TikTok simultaneously at that tier. A comment or first automated private reply is not durable email/SMS consent; direct visitors to Spartan's explicit signup form if they want updates. See Manychat's [Instagram comment-trigger limits](https://help.manychat.com/hc/en-us/articles/14281316989724-Instagram-Post-and-Reel-Comments-trigger).

Manychat pilot deliverables/acceptance: one fallback and human-handoff route, one UTM-tagged destination, a 30-day source-to-action report, a documented active-contact/cost ceiling and a pause switch. Test duplicate comments, private-reply limits, deleted posts and account disconnect. No customer enters email/SMS marketing without the separate Spartan consent flow.

### Automation boundary

- **Automate:** idea collection, drafts, variants, UTM creation, checklists, approved scheduling queues and metric summaries.
- **Owner approval:** public posts, promotions, prices, availability, product/nutrition claims and community-facing replies.
- **Human only:** health conditions, medications/GLP-1/peptides, allergies, children, adverse reactions, individualized advice, complaints, disputes and legal/compliance issues.

### Constraints and blockers

- Real store/menu/photo sources and current claim/offer decisions must be available to the source pack.
- Public posts, claims, promotions, prices and sensitive replies require owner approval.
- Native platform limits, API support, account eligibility and vendor pricing must be reverified before purchase.
- Metricool Free cannot carry the full cross-platform cadence; Manychat's entry tier cannot cover all three social channels.
- A publisher disconnect, deleted post or stale source must fail visibly and preserve a human fallback.

### Deliverables

- Spartan marketing project/source pack and reusable campaign prompt/skill.
- Four-week calendar and asset-capture checklist.
- Platform link/UTM table.
- Reply escalation matrix.
- Weekly approval routine and monthly source-to-conversion report.
- `campaign_content` registry with campaign/content ID, platform/profile, native post ID/permalink, content pillar, publish time, destination/UTMs, status, owner minutes and cost.
- Predeclared viral/spike-response SOP tied to platform-native baseline, tagged website actions and a 24-hour owner-approval window; never claim that social virality directly transfers Google ranking authority.
- 30-day native-versus-Metricool keep/change/stop decision.

### Definition of done

- Four weeks of approved content publish with correct tracking.
- No post publishes without its required human checkpoint.
- Reports connect traffic to menu views, calls, directions, claims, opt-ins and home-product actions now; redemptions/repeat behavior are added only after Project 2 provides a reliable join. Reach/likes remain diagnostic, not primary outcomes.
- Owner time remains below the target.
- A paid tool is retained only if it measurably saves time or improves attributable outcomes.
- For scheduled tasks, choose web-accessible versus local-project mode, make required sources available, approve the first three outputs, test stale-source/failure handling and never grant publishing or reply authority.

## Project 6 — Local reviews and reputation loop

### Business problem

More genuine current reviews strengthen local trust and Google prominence, but incentives create platform/policy risk and less trustworthy evidence.

### Scope

- One direct Google review link/QR and one private-feedback option on receipts, in-store signage and eligible follow-up email.
- Ask every eligible customer neutrally; do not ask only happy customers.
- Use real review excerpts only with source/date verification.
- Monitor review count, rating trend and response cadence at an aggregate level.

Recommended wording:

> Tell Bixby about your Spartan visit. Honest feedback helps local customers know what to expect.

No discount, free item, reward, entry or points may depend on a Google review—online or in store. Spartan's initial policy is no incentive for a review/rating on any platform; handle a disclosed public referral/share as a separate program only after approval. See [Google review-request guidance](https://support.google.com/business/answer/3474122), [Google Maps fake-engagement policy](https://support.google.com/contributionpolicy/answer/7400114) and [FTC social-media disclosure guidance](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers).

### Constraints and blockers

- Review requests must be neutral, offered consistently and never selectively gated toward presumed happy customers.
- No online or physical incentive, proof-of-review requirement, suggested rating or scripted positive wording.
- Direct Google review/profile links and QR assets must be rechecked before printing or sending.
- Private complaints and public reviews need a human response path; do not automate defensive or health-related replies.

### Deliverables

- Review QR/link assets and neutral copy.
- Private-feedback route and response procedure.
- Monthly review/reply checklist.
- Aggregate local-reputation scorecard.

### Definition of done

- Every review request offers an honest, non-gated choice.
- No proof of review is collected for a benefit.
- Complaints/private feedback receive a human response path.
- Website, Google and in-store review destinations remain current.

## Project 7 — Home delivery and Wellness Rewards/VIP handoff

### Business problem

Interested customers need a clear independent ordering path, while Spartan needs to distinguish outbound interest from completed accounts, VIP enrollments and orders.

### Scope

- Keep Spartan's shipped-products page Spartan-first while clearly disclosing that Herbalife handles account creation, payment, taxes, shipping, subscriptions, privacy, returns and support.
- Improve the authenticated Herbalife storefront profile without changing its URL or owner account number.
- Feature accurate recommended carts when the MyHerbalife Site Builder save/authentication issue is resolved.
- Educate customers about free Wellness Rewards and optional VIP/member savings without coaching/recruiting pressure.
- Reconcile verified outcomes from MyHerbalife/BizWorks rather than treating website clicks as conversions.
- Use Herbalife's native loyalty/referral capabilities; do not duplicate its points engine inside Spartan Rewards.

Current Herbalife Wellness Rewards material describes native points, subscriptions and a member-referral benefit. Treat those provider features as the home-product loyalty layer, while Spartan Rewards governs verified local-store activity. References: [Wellness Rewards benefits](https://assets.herbalifenutrition.com/content/dam/regional/nam/en_us/consumable_content/marketing_materials/flyer/wellness/2025/12-Dec/WRP_BenefitsOverviewDistributor_Flyer_USEN.pdf/_jcr_content/renditions/original) and [Wellness Rewards distributor FAQ](https://assets.herbalifenutrition.com/content/dam/regional/nam/en_us/sites/myherbalife/web_graphic/business/2025/11-Nov/HNR_WellnessRewardsDSFAQ_USEN.pdf/_jcr_content/renditions/original).

### Constraints and blockers

- Recommended Cart saving produced an AEM/authentication failure. If it persists, contact Herbalife Distributor Relations with the route, build/error text, timestamp and requested cart details.
- Exact BizWorks exports, completion fields, timing and any API access must be verified in the authenticated account.
- The public storefront currently needs a final brand/contact consistency check; keep the existing URL.

### Deliverables

- Approved storefront profile copy/assets and verified public preview.
- Recommended carts for the official Mega Tea On-the-Go Kit and Herbalife-approved To-Go Tea recipes offered through the official provider platform, using only currently permitted products, packaging and claims.
- Tracked Spartan outbound links and campaign naming.
- Monthly account/VIP/order reconciliation procedure.
- Customer-facing explanation of Spartan store rewards versus Herbalife Wellness Rewards/VIP.

### Definition of done

- The public storefront is correctly owner-attributed and uses approved identity/contact details.
- Customers can browse, create an account, pay and receive shipping through the provider flow without Spartan collecting enrollment/payment/shipping data.
- Website clicks remain intent events; verified signup/VIP/order counts come from authenticated reporting.
- A monthly scorecard reports anonymous shop/VIP clicks and authenticated provider account/VIP/order outcomes as separate series. Do not publish a click-to-outcome funnel rate until an approved campaign/customer link or lawful exact identity join exists.

## Project 8 — Spartan Games campaign framework

### Business problem

Customers need fun reasons to interact, contribute ideas and return, without turning the permanent customer system into a complicated game platform.

### Scope

Create a reusable campaign layer for no-prize polls, menu/theme research, recipe/name ideas and future weekly/monthly Spartan events. The weekly/monthly cadence remains a later decision: run and measure one no-prize pilot first, then choose whether recurring events justify the owner time.

### First low-risk campaign

`Spartan Games — Help Shape Bixby's Next Drink`

1. Suggest a menu theme.
2. Share a recipe/name idea using allowed ingredients.
3. Vote in a short preference poll.
4. Publish aggregate results and explain that Spartan may use the feedback in its independent menu decisions.

Begin as noncompetitive market research: promise no winner, prize, credit or guaranteed menu feature. No-prize polls and questions can test engagement before reward complexity.

### Constraints and blockers

- Spartan Games is a campaign layer; pausing it cannot break coupons, subscriptions, referrals or lifecycle messaging.
- If a creator is selected, credited, featured or rewarded, treat it as a potential skill-based game promotion and require current Herbalife review, official rules, eligibility, dates, objective judging criteria, selection method, prize/value disclosure, UGC permission and applicable platform/legal review before launch. A random drawing has its own additional requirements and is not part of the first campaign.
- Social interaction never creates email/SMS consent.
- Obtain permission for names, photos and user-generated content.
- Do not gamify weight loss, medical outcomes, reviews, consent or VIP enrollment.
- Project 2 campaign attribution and any Square purchase linkage must work before claiming store/repeat outcomes.
- Ingredient feasibility, product/claim review, moderation, duplicate controls and UGC/adult-or-guardian rules must be finalized before accepting public submissions.

### Deliverables

- Reusable campaign brief, landing module, submission/voting components and campaign IDs.
- Social/email/in-store asset kit.
- UGC/name/photo permission language.
- Rules template and policy review checklist.
- Campaign scorecard and post-campaign keep/change/stop decision.

### Definition of done

- Mobile entry/voting and duplicate controls pass.
- Source and campaign attribution work end to end.
- Aggregate results are published; any later menu choice is documented as Spartan's independent business decision rather than an awarded prize.
- The report shows attributable or directional visitors, menu views, claims and opt-ins; redemption/repeat reporting is added only after Project 2 provides a reliable join. Use `incremental` only when a documented holdout or credible experiment exists.
- A second campaign runs only if the first creates measurable value at acceptable owner time.

## Later projects and explicit deferrals

### SMS

Separate project only after email proves value. Requires separate unchecked consent, recorded disclosure/version/timestamp, terms, provider registration, frequency, STOP/help handling, quiet hours, suppression and counsel/compliance review. Historic unknown-consent numbers remain quarantined.

### Managed customer data hub

Potential future event store: Cloudflare D1 or Supabase/managed PostgreSQL behind the existing Cloudflare boundary, with adapters for Brevo, Square and MyHerbalife imports. Trigger only when manual joins or Sheets create measurable errors/work, and select only after an implementation comparison. Do not build telecom/email delivery or payment infrastructure.

### Reusable local-business product

Keep data boundaries, templates and provider adapters clean, but solve Spartan's workflow first. Do not add tenancy, billing, generalized admin permissions or white-label complexity until Spartan has a stable measured system.

### Unattended social publishing

Do not authorize fully autonomous health/product/promotional publishing. The highest useful automation is preparation, scheduling after approval, attribution and reporting.

### Historic contacts

Requested idea: one one-time email/SMS outreach asking unknown-consent historic contacts to grant permission. Status: **blocked and not approved for sending** pending source-by-source lawful-basis review, provider-policy approval and qualified compliance guidance, because the permission request itself is a marketing message. Recurring sends to unknown-consent contacts remain prohibited; keep them quarantined unless a reviewed record proves current channel permission.

### Deferred operations

- Square online-order merchant notifications remain an owner-deferred operational item; do not confuse website ordering clicks with completed/alerted orders.
- Social profile bio links should adopt the documented tagged URLs and be verified account by account.
- Exact Meta account-side automatic form/advanced-matching settings remain an external verification item.

## Measurement principles and provisional gates

The canonical formulas, milestones and alerts are in `MARKETING-MEASUREMENT-DICTIONARY.md`.

Highest-priority outcomes:

1. Website-offer claim-to-redemption rate.
2. 30-day repeat rate after first redemption.
3. Referred-customer redemption, repeat value and acquisition cost versus non-referral customers.

Supporting measures:

- Coupon completion and median claim-to-redemption time.
- Brevo-confirmed subscriber rate and interest-research completion.
- Referral share → claim → redemption → reward redemption.
- Menu/call/directions actions by source.
- Anonymous home-product clicks and separate verified provider account/VIP/order counts; no cross-series conversion rate without an approved join.
- Owner minutes and reward/technology cost.

Provisional decision gates:

- Investigate before changing the website if confirmed coupon claims remain more than 20% below a comparable 28-day baseline for seven days.
- If fewer than 40% of DOI requests confirm after at least 20 mature requests, treat it as a diagnostic signal—not a performance target—and inspect sender recognition/instructions before buying more traffic.
- Produce an operational interest/source status after 30 days, but do not make content decisions until at least 50 valid responses; always show counts and sample bias.
- Treat 20 matured referred claims as a workflow, abuse and reconciliation smoke test—not proof of profitability. Scale only after a larger matured cohort or multiple pilot periods, with observed attributable contribution above reward and operating cost.
- Keep a paid social manager only if it saves at least 30 minutes/week or improves attributable business actions.
- Do not use outbound Herbalife clicks as signup/VIP/order conversions.

All thresholds are provisional until Spartan has a clean baseline. Change them with a dated decision record, not silently.

## Execution sequence

1. **Complete:** Project 1 confirmation, Brevo interest/welcome flow and post-coupon discovery are live; monitor the first 30-day learning window.
2. **Next:** execute Project 2's Square redemption/customer-link SOP, manual ledger and weekly scorecard; collect a comparable 30-day baseline.
3. Start the no-added-cost social operating system and neutral review loop in parallel.
4. Run the manual referral MVP after the Project 2 redemption-measurement gate passes.
5. Add purchase-based lifecycle automation after redemption/return signals are trustworthy; keep the live welcome flow operating.
6. Reconcile authenticated Wellness Rewards/VIP outcomes and improve that handoff.
7. Run the first no-prize Spartan Games campaign after campaign attribution is proven.

Optional external wording review is outside the critical path and should be scheduled only if the owner wants it or a specific issue arises.

## Portfolio definition of done

The marketing system is not “done” merely because pages and forms exist. This portfolio is operating successfully when:

- The owner can see where customers came from, each meaningful milestone and the median time to the next stage.
- Coupon, email and reward flows are separately permissioned, server-confirmed and recoverable.
- Referrals can be compared with non-referral customers on redemption, repeat behavior and cost.
- Brevo can run approved lifecycle messages without manual customer-by-customer follow-up.
- Verified Herbalife account/VIP/order outcomes are reconciled rather than inferred from clicks.
- Social and Spartan Games content connects to measurable website/store actions.
- Reviews remain genuine and unincentivized.
- Customer data stays out of public URLs and advertising analytics.
- Owner work remains within the documented time budget and every automation can be paused.
- A dated monthly review makes explicit keep/change/stop decisions instead of adding features by habit.
