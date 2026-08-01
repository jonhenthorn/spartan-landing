# Spartan website form handler

This Apps Script replaces the current fire-and-forget form request. It writes a row first, then redirects the visitor back to the website with a success result. The website reveals a coupon or signup confirmation only after that redirect.

## Before publishing the refreshed website

1. Open the Google Apps Script project that currently owns the website lead Sheet.
2. Preserve a copy of the current script.
3. Replace its form-handler code with `Code.gs` from this folder.
4. In **Project settings → Script properties**, add:
   - `SPREADSHEET_ID`: the long ID from the Google Sheet URL.
   - `SHEET_NAME`: the tab that currently stores website leads. Use `Leads` if that is its name.
5. Deploy a new version of the existing web app:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Confirm that the deployment retains the endpoint already referenced by `index.html`. If Google creates a new `/exec` URL, update both form `action` attributes in `index.html`.
7. Test with clearly labeled internal records before publishing the website.
8. Confirm the Sheet contains the new columns and that both a coupon claim and an email signup redirect back successfully.

Do not deploy the new website form before the Apps Script update. The existing production endpoint currently expects a different request method.

## What is recorded

- Coupon claims and email signups are different `record_type` values.
- Coupon claims record email permission as `granted` only when the optional, unchecked email box is selected; otherwise it is `not_requested`. SMS remains `not_requested`.
- Email signups record the consent timestamp, exact consent language, language version, form, source page, and opt-out status.
- SMS permission remains `not_requested`; this phase does not create an SMS list.
- Tags distinguish website coupon claims from dedicated updates signups.
- Coupon records include blank owner-managed fields for redemption date and Square transaction ID; the website never marks its own coupon as redeemed.
- Existing Sheet columns remain in place. New columns are appended to the header row.
