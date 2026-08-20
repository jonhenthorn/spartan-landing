# Project 2 — local Code128 POS scan preflight

Status: **local preparation only; no production activation or data write is authorized.**

This preflight package answers one narrow question: can the intended checkout scanner exactly decode the connector's Code128 rendering? The generator imports the same renderer used by `square-worker/src/index.mjs`. Generating it does not call Square, Cloudflare or any website, and it writes only a short-lived package in the system temporary directory. Performing the later physical scan is a separate, explicitly approved live read-only action on the intended checkout device.

## Choose the correct mode

Use **random/unassigned hardware-readability mode** by default. Its fresh code is not linked to a customer. A beep, accepted search or no-results lookup is inconclusive because it does not prove that the complete value decoded exactly. PASS requires the package-bound local verifier to return `SCAN_COMPARE_PASS`. Even that exact match proves only Code128 decoding; it does not prove a customer lookup or attachment, eligibility, a discount, redemption, an order or a completed sale.

Use **existing labeled test-profile mode** only if all of these are already true before the scan:

1. The profile is the existing owner-controlled labeled test profile—not a real customer.
2. Its Reference ID already starts with `SPN1-` and has not been added, replaced or edited for this preflight.
3. The owner can copy that exact existing value without putting it in a note, command argument, screenshot or worksheet.
4. The intended device has a read-only customer lookup path. If it requires starting a sale, creating/saving a customer or changing the reference, stop; that belongs to a separately approved production canary.

Without every prerequisite, any readable scan remains hardware-only evidence.

## Prepare locally

First run the package-specific validator:

```sh
node scripts/validate-pos-code128-preflight.mjs
```

For the normal random/unassigned test:

```sh
node scripts/generate-pos-code128-preflight.mjs --random
```

For the existing labeled test profile, keep the value out of terminal echo and command history. In zsh, paste it into this masked prompt:

```sh
read -rs "pos_scan_reference?Paste the untouched test-profile reference: "
printf '\n'
printf '%s' "$pos_scan_reference" | node scripts/generate-pos-code128-preflight.mjs --existing-reference-stdin --ack-existing-untouched-test-profile
unset pos_scan_reference
```

The generator refuses direct terminal input and requires the explicit untouched-profile acknowledgement. It never prints the reference. The generated HTML contains only the rendered bars, not the plaintext value.

The command prints a new temporary directory containing exactly:

- `scan.html` — offline barcode page with no script, form, analytics, external asset or web request.
- `worksheet.md` — an immutable restricted template for the allowed private record fields; never edit this hashed package file.
- `manifest.json` — mode, creation time, the two expected filenames, SHA-256 hashes for the generated page and worksheet, and a random-salted one-way digest used for exact local comparison; no plaintext encoded value.

## Run the physical scan

1. Open `scan.html` locally on a separate screen at normal page zoom and high brightness. Do not host it or put it in a web address.
2. On the intended checkout device, use a read-only customer lookup/search screen with no sale or order open.
3. Scan once. If needed, retry at a different distance or screen brightness, up to three total attempts.
4. Obtain the complete decoded input without saving it. If the scanner can act as a keyboard, scan directly into the masked prompt below. Otherwise copy the complete value from the read-only search field and paste it into the masked prompt. If the device cannot expose the complete decoded input without a save or data change, mark the attempt FAIL.
5. Replace the package-directory placeholder with the exact directory printed by the generator. The value is held only in the temporary shell variable, passed through standard input, never echoed, and never written by the verifier:

   ```sh
   read -rs "pos_decoded_scan?Scan or paste the complete decoded input: "
   printf '\n'
   printf '%s' "$pos_decoded_scan" | node scripts/generate-pos-code128-preflight.mjs --verify "/printed/package/directory"
   unset pos_decoded_scan
   ```

6. Record PASS only for `SCAN_COMPARE_PASS`. Record FAIL for `SCAN_COMPARE_FAIL`, a beep/accepted-search/no-results result without comparison, a partial or unavailable decoded input, or any hard stop.
7. In existing-profile mode, stronger lookup or attachment proof is allowed only when the pre-existing untouched-reference prerequisites above were satisfied and the exact labeled test profile appears. Do not interpret a different profile, a generic beep or a random-code result as attachment proof.
8. Before scanning, copy the allowed blank field set below into the private Project 2 record. Record results only in that private copy; never edit `worksheet.md` or another package file. Do not record the scanned value or any identifier shown by Square.

## Owner worksheet field template

| Field | Entry |
| --- | --- |
| Checkout device label | |
| Scanner or built-in camera | |
| POS screen or mode | |
| Test mode | hardware-readability-random-unassigned / existing-labeled-test-profile-untouched-reference |
| Test date and local time | |
| Attempt 1 | PASS / FAIL |
| Attempt 2 | PASS / FAIL / NOT RUN |
| Attempt 3 | PASS / FAIL / NOT RUN |
| Final result | PASS / FAIL |

Use a friendly device label, never a serial number or account identifier. Do not add a notes field. Never record a name, phone, email, customer/order/payment/location/discount identifier, encoded SPN1 value, receipt, screenshot, link or web address.

## Hard stops

Stop immediately and mark the attempt FAIL if:

- a different or unexpected customer appears;
- the exact package-bound comparison cannot be completed;
- Square offers to create or edit a customer;
- a reference would need to be added, replaced or saved;
- a sale or order must be started;
- any discount is applied or redemption state changes;
- a screenshot, log, note or worksheet would capture the encoded value; or
- three attempts fail.

Do not troubleshoot by editing a live profile, opening a transaction, applying a discount, creating a customer or moving to a different production workflow. This package cannot complete the production owner canary.

## Cleanup

After recording the allowed PASS/FAIL fields in the separate private Project 2 record without editing the package template:

1. Close the barcode page and the Square customer/search screen without saving.
2. Clear the clipboard if it carried the existing test reference or decoded scan input.
3. Remove any transferred copy or screenshot of the barcode.
4. Run the exact `--cleanup` command printed by the generator.
5. Confirm the temporary directory no longer exists.

Cleanup is intentionally narrow. It refuses a target outside the system temporary directory, a renamed package, a symlink, a malformed manifest, generated content that no longer matches the manifest hashes, or any unexpected file. It removes the generated page and worksheet sequentially, keeps the manifest until last, and can resume safely if one of those two content files was already removed. It then removes the manifest and the empty package directory.

The physical result remains **not run** until an owner actually performs this worksheet on the intended checkout device. Local validation confirms only the generator, renderer parity and safety boundaries.
