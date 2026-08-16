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

## Project 0 — Offer channel and reward-rule decision

### Business problem

Spartan needs a profitable first-visit/referral program, but the current published rules do not confirm that a public website click becomes a private invitation or support public numeric/free offer wording without an exception.

### Confirmed current rule boundary

Current U.S. Herbalife guidance expressly permits public terms such as `discount`, `deal`, `offer`, `sale`, `special` and `coupon` for prepared consumptions and single-serve kits. It does not expressly confirm `customer reward` as approved public wording. Public promotion must not display dollar amounts, percentage amounts or wording implying `free`. Herbalife's current interactive guide describes private price communication to existing customers and prospects after qualifying prior personal contact or expressed interest; whether Spartan's public form creates that qualifying relationship remains unresolved and is therefore included in the written questions below.

A public click by itself is **not documented as converting a public webpage into a personal invitation**. Current price-advertising guidance says a clickable public promotion may only take the user to a private chat or DM page and may not take the user to a discount page. Herbalife separately permits a public Google Form without pricing to collect prospective-customer information. Whether a promotional website CTA may open such a form and then deliver the numeric offer through an individualized automated response remains an unresolved interpretation requiring written confirmation.

Therefore the answer to “are we good?” is:

- **Yes, proceed with the internal journey, measurement and rewards design.**
- **No, do not call the public-to-private implementation fully cleared yet.** Obtain one written case response before launching new public reward language or assuming a click is a personal invitation.
- Safer published-rule wording is `First-time customer drink offer`, `Request your first-visit coupon`, or `Message us about our prepared-drink special`. Keep `customer reward` wording provisional until Herbalife answers it in writing.
- Exact numeric or `free` reward language belongs in a rule-approved private channel or individualized response.
- Absent a retained written exception or official-program approval, current published guidance does not support publicly displaying `50% off` or `$5 To-Go Tea`. Treat both as urgent compliance-remediation decisions while obtaining the case response. Do not change them silently, but do not describe continued public display as cleared.

Primary references:

- [Herbalife U.S. Rules of the Road, revised June 12, 2026](https://assets.herbalifenutrition.com/content/dam/regional/nam/en_us/consumable_content/marketing_materials/guides/2020/11-Nov/RulesofConduct_EN.pdf/_jcr_content/renditions/original)
- [Herbalife U.S. Price Advertising Guidelines, March 4, 2026](https://assets.herbalifenutrition.com/content/dam/regional/nam/en_us/consumable_content/policy-and-compliance/2024/10-oct/Price_Advertising_Guidelines_USEN.pdf/_jcr_content/renditions/original)
- [Herbalife Price Advertising Interactive Guide](https://hnx.myherbalife.com/price-advertising)
- [Nutrition Clubs: What is allowed and not allowed, May 2026](https://assets.herbalifenutrition.com/content/dam/regional/nam/en_us/consumable_content/policy-and-compliance/2026/05-may/MPC_AllowedAndNotAllowed_NAM_USEN.pdf/_jcr_content/renditions/original)

### Written questions to retain with the project

Ask Herbalife Compliance for a case number and written answers to these exact implementation questions:

1. May the public Spartan website say `First-time customer drink offer` or `Claim your first-visit reward` without showing an amount, percentage or `free`?
2. Does clicking that public call to action constitute prior personal contact or an expression of interest?
3. Must the call to action open a private SMS, Facebook Messenger or Instagram DM, or may it open a public form that contains no price and collects a prospect's request and contact information?
4. After submission, may an automated one-to-one email, SMS or DM state `50% off your first prepared drink`?
5. May that private response link to an individualized, non-indexed, single-customer coupon page?
6. May Spartan operate a deterministic reward in which an existing customer earns a prepared-drink reward only after a referred first-time customer redeems in store?
7. May the public website say only `Earn Spartan rewards` while exact reward values appear privately?
8. May a customer publicly share a tracked referral link if the post contains no numeric/free language and discloses that the customer may earn a Spartan reward?
9. Is a complete-task-and-earn-reward program outside game-promotion rules when there is no chance, drawing, judging or competitive winner?
10. Must the current public `50% off your first drink` and `$5 To-Go Tea` wording be moved to private communication?

### Scope

Scope is limited to obtaining and operationalizing the current written channel/wording answer. It is not a legal opinion or permission to redesign the full website.

### Constraints and blockers

- Public-click/private-invitation treatment is unresolved in the published materials.
- Current public numeric offer/price wording requires an urgent explicit decision.
- The implementation cannot be finalized from an internal interpretation alone; retain the official written response and case number.
- This project does not authorize a website, social, email or reward launch by itself.

### Deliverables

- Herbalife case number and retained written response.
- Decision table for public website, indexed pages, non-indexed result pages, email, SMS and social DM wording.
- Explicit keep/change decision for current first-visit and To-Go Tea copy.
- Approved public invitation, private offer, referral and reward vocabulary.
- Dated note identifying who approved the business implementation.

### Definition of done

- All ten questions have written answers or clearly marked unresolved items.
- Public numeric/free language is either supported by retained guidance or moved to the approved private channel.
- The website/social/email implementation test proves the numeric offer cannot leak into an unapproved public/indexable surface.
- Staff and owner use the same current offer/reward terms.
- Any later rule change can be traced to this decision record without guessing.

## Current confirmed foundation

- The website records server-confirmed first-visit claims and separate, auditable email permission in Google Sheets.
- Brevo handles double opt-in, unsubscribe and suppression. Confirmed Brevo list membership is the subscriber source of truth.
- GA4 measures cleaned anonymous website actions and campaign attribution. The replayable Brevo return URL is directional, not proof of list membership.
- The current GA4 implementation does not provide an apples-to-apples pre-rebuild visitor baseline. Make forward decisions from comparable post-launch periods and business outcomes rather than raw legacy-versus-new page-view totals.
- One permanent 15-minute Apps Script trigger sends counts-only owner submission alerts. Customer details remain in the restricted Sheet.
- Search Console, GA4, Google Business Profile, Cloudflare redirects, social links, the menu pages and the shipped-product handoff are deployed.
- The website can measure outbound home-product and VIP interest. It cannot currently prove a completed Herbalife signup, VIP enrollment or shipped order.
- Square is the operational source for prepared-drink sales and redemptions, but there is no reliable automated customer-level join between Square and website submissions yet.
- The active website/data contract supports `coupon_claim` and `email_signup`. It does not yet support interest research, discovery-source updates, referral codes, rewards or lifecycle milestones.

## Portfolio priority

Priority is based on expected business value, time to learning, build/maintenance cost, owner involvement and dependency risk. Scores are provisional decision aids, not measured performance.

| Rank | Project | Planning score | Expected value | Effort | Maintenance | Owner burden after setup | Timing |
| ---: | --- | ---: | --- | --- | --- | --- | --- |
| 0 | Offer-channel and reward-rule decision | Gate | Critical risk control | Low | Very low | One-time | Start now; blocks public reward launch |
| 1 | Customer insight and confirmation foundation | 93 | High | Low-medium | Low | Very low | Build first |
| 2 | Journey measurement and identity foundation | 91 | Very high | Medium | Low-medium | Low | Design with Project 1; implement in stages |
| 3 | Referral and Spartan Rewards MVP | 88 | Very high potential | Medium | Medium during pilot | Low after proof | After Projects 0–2 |
| 4 | Lifecycle email and re-engagement | 84 | High | Medium | Low | Very low | After reliable redemption/return signals |
| 5 | Social content and engagement operating system | 82 | High | Low initially | Medium | 75–100 min/week initially | Begin in parallel at no added cost |
| 6 | Local reviews and reputation loop | 79 | High | Low | Low | Low | Begin in parallel, no incentives |
| 7 | Home-delivery and Wellness Rewards/VIP handoff | 76 | Medium-high | Medium | Low | Low | Improve after completion reporting is verified |
| 8 | Spartan Games campaign framework | 68 | Medium/experimental | Low-medium | Medium while active | 45–75 min/week | After journey tracking works |
| Later | SMS, managed data hub and reusable product | — | Unknown until evidence | High | Medium-high | Varies | Explicit later-stage gates |

Projects 1 and 2 share event names and data definitions, but they should not ship as one large risky release. Project 5 may run in parallel because it can use the current tracked links without changing the customer database. Projects 3, 4, 7 and 8 depend on trustworthy Project 2 milestones.

### Operating register

| Project | Status | Business owner | Dependency/blocker | Next action | Target release | One-time/monthly cost | Owner-time ceiling | Stop gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 Offer/rule decision | External answer required | Owner | Written Herbalife interpretation | Submit ten questions and retain case response | Immediate | `$0` internal; outside review TBD | One-time | Do not launch new public reward language without answer |
| 1 Insight/confirmation | Ready to implement in three releases | Owner with technical support | Brevo profile-form capability; bounded source endpoint | Confirmation card first | Next website release | Current tools; build time TBD | ~15 min/month after launch | Roll back any question that reduces claim/signup completion |
| 2 Measurement/identity | Design ready; implementation gated | Owner with technical support | Reliable Square identifier; provider report fields | Define Square SOP and 30-day baseline | Parallel design, staged delivery | Pilot `$0`; future data store TBD | ≤15 min/week | Defer automation if match coverage/owner burden fails |
| 3 Referral/Rewards MVP | Planned, not live | Owner | Projects 0–2 | Finalize terms and manual 60-day pilot | After gates | Reward economics TBD; software `$0` pilot | ≤30 min/week pilot | Stop for fraud, weak observed contribution or excess work |
| 4 Lifecycle email | Planned | Owner | Trusted redemption/return signal | Welcome automation, then one measured reminder | After Project 2 signal | Current Brevo limits; upgrades TBD | ~15 min/month | Pause on consent errors, complaints or no directional value |
| 5 Social operating system | Ready for Stage 0 | Owner | Source pack and approval routine | Run four-week native-tools baseline | Start in parallel | `$0`; paid tool only after test | 75–100 min/week initially | No paid tool without ≥30 min/week saved or better actions |
| 6 Reviews/reputation | Ready, no incentives | Owner | Current QR/link and neutral copy | Build digital/in-store request assets | Start in parallel | `$0` digital; printing TBD | ~15 min/month | Stop any selective/incentivized practice immediately |
| 7 Home/VIP handoff | Partly live; reporting blocked | Owner | Site Builder AEM issue; BizWorks fields | Verify reports and resolve cart/profile backlog | After report verification | Provider tools; support cost TBD | 5–10 min/month | Do not report clicks as completions |
| 8 Spartan Games | Concept only | Owner | Project 2 attribution; campaign review | Run no-prize research pilot | After attribution baseline | `$0–$100` pilot | 45–75 min/week while active | Do not repeat without measurable value and acceptable work |

`TBD` means the amount must be verified before approval; it is not assumed to be zero.

## Project 1 — Customer insight and confirmation foundation

### Business problem

Subscribers do not get an obvious confirmation experience, and Spartan cannot yet answer why people discovered the site or what future content they would value.

### Scope

Deliver three bounded releases:

1. **Confirmation return card:** make the Brevo return visually unmistakable without falsely claiming that a replayable URL itself proves list membership.
2. **Content-interest research:** use a Brevo contact-specific profile-update form after double opt-in.
3. **Discovery source:** ask one optional question after a new coupon is already confirmed and visible.

### Confirmation experience

Recommended page state:

- Eyebrow: `Spartan Updates`
- Heading: `Thanks for checking your email.`
- Body: `Your confirmation link was opened. If Brevo completed the confirmation successfully and your address remains subscribed, you're set to receive Spartan Updates. Watch for menus, special hours, announcements, occasional offers and make-at-home updates. You can unsubscribe in any email.`
- Next actions: `View the menu`, `Get directions`, `Follow Spartan`

Brevo confirmed-list membership remains authoritative. The URL return event must not become a key conversion or subscriber count. Show a definitive `Subscription confirmed` state only if the backend verifies current Brevo membership without exposing contact identity in the URL, or if a signed, bounded confirmation receipt is implemented and independently tested.

### Content-interest research

Recommended prompt:

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

- Optional; Skip is always available.
- Ask for zero to three selections; no preselection. If Brevo's current profile-form control cannot enforce a maximum, accept extra choices rather than blocking the response, and record that limitation in the launch evidence.
- It is research/segmentation, not consent and not an exclusive delivery preference.
- Keep one general Spartan Updates list rather than nine lists.
- Store current choices in a Brevo `CONTENT_INTERESTS` multiple-choice attribute. The Phase 1 profile form updates current selections; it is not append-only history.
- Document the profile-form/question version and monthly aggregate snapshot date. If per-contact response history is later required, add a separate versioned first-party research event rather than claiming the overwritten Brevo attribute is an audit log.
- Invite people to update the answer no more than every 6–12 months.
- Do not ask whether a person uses GLP-1 medication, peptides or supplements; has a diagnosis; or wants a specific medical/weight outcome.
- If research news ranks highly, pilot one monthly evidence digest using primary research, systematic reviews or authoritative guidance, with source links, study limitations, no individualized advice and human review.
- General research content must not be translated into a disease, therapeutic or product-benefit claim. Do not connect a study to a Spartan or Herbalife product unless the exact claim is supported by the current product label or retained Herbalife-approved material. Treat health/research interests as potentially sensitive, use aggregate demand first and cover their use in the privacy notice.

Use Brevo's contact-specific [profile-update form](https://help.brevo.com/hc/en-us/articles/360003644360-Update-your-contacts-details-and-preferences-profile-update-form) after confirmation. Do not place this question inside the current coupon form.

Configure the profile form to change only `CONTENT_INTERESTS`. Test that it updates the existing contact, does not change email/phone/list membership, does not resubscribe an unsubscribed contact, and behaves safely on replay. Verify live whether the builder can enforce `choose up to three`; treat it as guidance unless enforcement is proven.

### Discovery-source research

Recommended prompt after the coupon is already shown:

> One quick question—how did you first hear about Spartan? Optional.

Choices:

- Google Search
- Google Maps
- Facebook
- Instagram
- TikTok
- Friend or family
- Drove by / nearby
- Community event or local group
- Other

Store self-reported source separately from referrer and UTM values; disagreement is valid information. Save to the already-confirmed record or a linked research record, never as a second lead. Send only a generic anonymous completion event to GA4.

### Constraints and blockers

- A replayable confirmation URL cannot securely identify a subscriber. Use Brevo's contact-specific link for interest updates.
- The discovery answer requires a narrowly allowlisted Worker/Apps Script contract change and Sheet fields.
- No PII, interest choice or discovery response goes to GA4 or Meta.
- Confirmation, coupon delivery and signup can never depend on answering research questions.

### Deliverables

- Accessible confirmation-return card.
- Brevo `CONTENT_INTERESTS` multiple-choice attribute and profile-update form.
- Welcome-email link to the interest form.
- Post-coupon discovery control and bounded storage path.
- Topic/source report with question versions and response counts.
- Monthly aggregate interest snapshot; no claim of per-contact history unless a first-party research ledger is later approved.
- Privacy-copy update and automated tests.

### Definition of done

- Confirmation return is obvious on 320, 390 and 430 pixel mobile widths and desktop.
- The form is not shown as though another signup is required on that return.
- Interest and discovery questions are optional, unselected by default and never reduce coupon/subscription completion.
- Contact-specific interest changes update the existing contact rather than creating duplicates.
- An operational status is produced after 30 days. Treat content decisions as directional only after at least 50 responses; report the selection bias that interests represent confirmed subscribers who received/used the profile opportunity and discovery answers represent new coupon claimants, not all visitors or store customers.
- Brevo remains authoritative for confirmed subscribers; no personal data reaches analytics.

## Project 2 — Journey measurement and identity foundation

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
- Define stable internal contact/customer/referral identifiers.
- Require a reliable Square procedure for attaching the offer/referral to a customer or transaction.
- Price and test Square Loyalty/customer profiles before building a second local points engine. Prefer the native POS workflow if it can represent the approved Spartan rules, customer linkage and audit trail at acceptable cost; keep the referral attribution and cross-system measurement logic provider-neutral. See [Square Loyalty API overview](https://developer.squareup.com/docs/loyalty-api/overview).
- Maintain a small append-only redemption/referral ledger instead of editing historical events.
- Reconcile Brevo confirmations and unsubscribes.
- Import or reconcile authenticated MyHerbalife/BizWorks completion reports on a monthly basis if export fields allow it.
- Publish a weekly aggregate scorecard and exception list; do not ask the owner to monitor every person manually.

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

Run a deterministic 60-day pilot only after the offer/reward wording is cleared and Project 2 can verify a redemption:

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
- Do not activate a rewarded public-share task until the retained Herbalife response confirms the public/private channel design. Any approved share must omit numeric/free language, use the approved destination, disclose the material connection clearly—for example, `I may earn a Spartan reward if you use my link`—and satisfy the platform's promotion/endorsement rules.
- No self-referrals, cash value, stacking or duplicate first-time customers.
- Use one reward per transaction, 60-day expiry and a provisional cap of ten earned rewards per customer/month until fraud and profitability are understood.
- Keep referral participation independent of email/SMS consent, reviews and Wellness Rewards/VIP enrollment.
- Give non-marketing-consented customers access to their referral code in store, on an eligible receipt or through a customer-initiated result page. Deliver referral messages by email/SMS only when current permission for that channel exists.
- Exact public and private reward wording/value remain pending the written Herbalife decision.
- Every qualifying prepared-drink redemption, including a zero-price or discounted reward if approved, must be separately and accurately documented through the applicable Herbalife receipting process with the actual price paid. The Square ledger does not replace required Herbalife receipting.

### Task/reward policy

Start with one commercially meaningful task: a referred friend completes a first visit. Do not launch a large points catalog yet.

Potential later tasks, each requiring its own economics and policy check:

- Complete a second tracked visit.
- Try a new drink category.
- Participate in a future deterministic poll/feedback reward only as a separate Project 3/8 experiment with its own economics and rule review. The first Spartan Games pilot remains no-prize and offers no participation reward.
- Share a tracked public referral with the required disclosure only after the retained Herbalife response clears the channel design.

Never reward a Google review, a positive rating, marketing consent, health outcome or membership enrollment. Do not award value merely for a social like/comment because it is easy to game and weakly tied to revenue.

### Constraints and blockers

- Requires Project 0's written public/private offer and reward-wording decision.
- Requires a reliable Square customer/order/referral link and required Herbalife receipting.
- Reward amount, COGS, margin, fraud cap, expiry and staff procedure remain to be finalized.
- Public sharing remains blocked until the retained Herbalife response clears the channel and disclosure design.
- Twenty matured referred claims are only a workflow smoke test; the pilot needs more matured evidence before scaling.

### Deliverables

- Referral code/QR generation and share page.
- Public invitation copy, private offer message and material-connection disclosure.
- Eligibility, expiry, exclusions, cap, fraud and support terms.
- Manual referral/reward ledger with state transitions.
- Square redemption, Herbalife receipting and reconciliation procedure plus staff quick guide.
- Referral cohort report and reward-cost/profitability model.

### Definition of done

- Written rule interpretation and final offer/reward language are retained.
- Twenty or more matured referred claims complete the workflow/abuse/reconciliation smoke test; profitability/scaling waits for a larger cohort or multiple pilot periods.
- The referrer is rewarded only once after a verified qualifying redemption.
- Self-referrals, duplicates, reversals and expired rewards are handled.
- Required Herbalife consumption receipts reconcile to the actual amount paid and the Square/reward record.
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

1. Submit the offer/reward channel questions and retain the written case answer.
2. Implement Project 1's confirmation card.
3. Configure Brevo content-interest research and welcome-email link.
4. Implement the post-coupon discovery-source question as its own bounded backend release.
5. Finalize the Project 2 event/identity model and Square redemption-link procedure; collect a 30-day baseline.
6. Start the no-added-cost social operating system and neutral review loop in parallel.
7. Run the manual referral MVP only after the rule and measurement gates pass.
8. Add lifecycle automation only after redemption/return signals are trustworthy.
9. Reconcile authenticated Wellness Rewards/VIP outcomes and improve that handoff.
10. Run the first no-prize Spartan Games campaign after campaign attribution is proven.

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
