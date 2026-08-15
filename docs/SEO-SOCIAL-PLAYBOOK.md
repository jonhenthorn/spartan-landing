# Spartan local SEO and social playbook

This is the low-maintenance operating routine for making the website, Google Business Profile, Facebook, Instagram, TikTok and email support the same customer journey. It does not promise a particular ranking. Google local visibility depends primarily on relevance, distance and prominence, so the goal is consistent business information, genuinely useful local content, real customer activity and accurate measurement.

## Canonical destinations

- Website: `https://spartandrink.com/`
- Permanent menu: `https://spartandrink.com/#permanent-menu`
- Current menu release: `https://spartandrink.com/#current-release`
- First-visit offer: `https://spartandrink.com/#first-visit`
- Mega Tea Kits: `https://spartandrink.com/#mega-tea-kits`
- Google profile: `https://www.google.com/maps?cid=1058402923204900530`
- Google review request: `https://g.page/r/CbL23NrZM7AOEBE/review`
- Facebook: `https://www.facebook.com/bixbyspartannutrition/`
- Instagram: `https://www.instagram.com/bixbyspartannutrition/`
- TikTok: `https://www.tiktok.com/@spartan_nutrition`

Keep the business name, address, phone, hours, website and categories aligned wherever they appear. Update the visible website hours and LocalBusiness structured data together. Use the exact Google profile—not a generic Google search—for reviews and special-hours checks.

## One release, several channels

When a monthly or seasonal menu changes:

1. Replace the current-release image and update its descriptive alt text on the website.
2. Update the Google Business Profile menu photo or menu link and publish one accurate update.
3. Publish the same release on Facebook, Instagram and TikTok using platform-native media.
4. Send it to opted-in Spartan Updates subscribers only when the release is useful enough to justify an email.
5. Use the same lowercase campaign name everywhere so GA4 can reconcile website visits and actions.

This creates a connected campaign without copying identical long-form text everywhere. Social reach can create referral visits, branded searches, shares and real-world visits; it is not treated as a direct Google ranking guarantee.

## Campaign-link standard

Use lowercase words separated with underscores. Never put a customer name, email address, phone number or other personal information into a URL.

| Channel | `utm_source` | `utm_medium` | Example destination |
| --- | --- | --- | --- |
| Instagram | `instagram` | `organic_social` | `https://spartandrink.com/?utm_source=instagram&utm_medium=organic_social&utm_campaign=monthly_menu_2026_08&utm_content=reel_01` |
| Facebook | `facebook` | `organic_social` | `https://spartandrink.com/?utm_source=facebook&utm_medium=organic_social&utm_campaign=monthly_menu_2026_08&utm_content=post_01` |
| TikTok | `tiktok` | `organic_social` | `https://spartandrink.com/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=monthly_menu_2026_08&utm_content=video_01` |
| Google profile | `google` | `organic` | `https://spartandrink.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp_website` |
| Brevo | `brevo` | `email` | `https://spartandrink.com/?utm_source=brevo&utm_medium=email&utm_campaign=monthly_menu_2026_08&utm_content=menu_button` |

For permanent social-profile bio links, use campaign `profile` and content `bio`. Do not add UTM parameters to links between pages or sections on the Spartan website.

## Local-search maintenance

Monthly, or whenever facts change:

- Confirm hours, holiday hours, phone, address, menu link, photos and social profiles in Google Business Profile.
- Add the current menu image and several honest, current store or drink photos.
- Ask real customers for an honest Google review using the direct review link or a QR code. Do not reward, gate or script positive reviews.
- Reply briefly and authentically to new reviews, especially questions or service concerns.
- Confirm the website still naturally describes energy teas, protein shakes, nutrition shakes, protein coffee, Mega Tea Kits, Bixby, South Tulsa and the 151st & Memorial location.
- Keep unsupported nutrition, dietary, medical or weight claims off the site even if they appear attractive as keywords.

Quarterly:

- Review Google Search Console queries, pages, clicks, impressions, click-through rate and average position.
- Review GA4 acquisition by source/medium and compare calls, directions, coupon confirmations, menu views, online-menu clicks and Mega Tea Kit interest. Use Brevo—not a replayable website return URL—for confirmed subscriber growth.
- Compare website results with Google Sheet coupon claims, Square coupon redemptions and Google Business Profile calls/directions. Do not treat page views alone as business success.
- Refresh weak titles or copy only when query and conversion evidence identifies a real gap.

## Technical guardrails

- Keep `https://spartandrink.com/` as the only canonical homepage.
- Preserve single-hop permanent redirects from HTTP, `www`, `/index.html` and legacy `/spartan-landing` URLs.
- Keep `robots.txt`, `sitemap.xml`, page metadata, social-card metadata and LocalBusiness structured data valid.
- Submit the sitemap and inspect the homepage in the verified Search Console domain property after meaningful releases.
- Keep page weight low; do not restore the old heavy map iframe, duplicate landing page or unused JavaScript libraries for SEO appearance.
- Earn legitimate local links through actual Bixby organizations, events, teams, suppliers or news coverage. Do not buy links, swap large batches of links or stuff city names into repetitive copy.
