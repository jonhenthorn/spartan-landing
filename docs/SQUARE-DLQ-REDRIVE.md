# Project 2 — sandbox DLQ inspect/redrive tool

Status: **local tool prepared; no Queue message has been inspected, moved or deleted.**

This tool closes the tooling gap in the `Q-02` acceptance plan. It uses Cloudflare's official Queue `peek`, `push` and peeked-message `purge` APIs. Peek does not lease or remove a message. A redrive pushes the exact validated message to the sandbox main Queue first, then removes only the matching peek reference from the sandbox DLQ.

It is deliberately not a general Queue browser:

- only `https://api.cloudflare.com` is reachable;
- the account, main Queue and DLQ must be three exact lowercase 32-character identifiers and the two Queue IDs must differ;
- it asks Cloudflare for at most two visible messages and stops unless exactly one is visible and that message is the privately expected synthetic `square_webhook` or `outbox` message;
- it accepts only the connector's exact two-field Queue bodies;
- it never prints the token, target identifier, Queue body, message ID, peek reference, API response or raw error;
- before peeking, it resolves both supplied Queue IDs and requires their names to be exactly `spartan-square-connector-sandbox` and `spartan-square-connector-sandbox-dlq`;
- it requests up to two visible DLQ messages and proceeds only when exactly one is visible and that one exactly matches the private target supplied by the operator;
- inspect-only makes one non-removing peek request after the two Queue-name boundary checks;
- redrive requires two explicit command acknowledgements and never retries;
- after the main-Queue POST begins, any disconnect, timeout, non-success or unreadable response reports `DLQ_REDRIVE_AMBIGUOUS_AFTER_PUSH`; the DLQ message is left untouched, but the main push might have been accepted, so the operation must not be repeated blindly;
- a failed exact-reference purge after a confirmed push reports the same ambiguous code and likewise requires reconciliation before any further action.

The push-then-purge order is intentionally at-least-once. If Cloudflare accepts the push but the later purge is uncertain, the original may remain in the DLQ. Preserve that result and reconcile D1 before doing anything else; the connector's D1 idempotency must prevent a second business outcome.

## Permission boundary

Cloudflare currently requires `Queues Write` (or the broader `Workers Scripts Write`) for Queue peek, push and purge. Use a new temporary API token scoped to the single Spartan Cloudflare account with **Queues Write only**, the shortest practical expiration and no Workers Scripts, zone, D1, R2 or account-administration permission. Cloudflare's token policy is account-scoped rather than restricted to one Queue, so the credential is broader than the two case Queues even though the tool is not. Creation, entry, use and revocation of that token require a separate live approval.

Do not reuse Wrangler's login credential, a global API key or the Queue-monitoring read token. Never put the token or private target ID in Git, a command argument, an environment file or evidence.

## Local validation

```sh
node scripts/validate-square-dlq-tool.mjs
```

The validator mocks every network response. It does not contact Cloudflare.

## Owner-controlled input

Run only after the full `Q-02` live window is approved, the DLQ baseline is exactly one labeled synthetic message and the main Queue consumer is in its reviewed recovery state. Use a shell with tracing disabled and a cleanup trap:

```sh
(
  set +x
  trap 'unset cf_account_id main_queue_id dlq_id queues_token target_kind target_id' EXIT INT TERM HUP
  read -r "cf_account_id?Cloudflare account ID: "
  read -r "main_queue_id?Sandbox main Queue ID: "
  read -r "dlq_id?Sandbox DLQ ID: "
  read -rs "queues_token?Temporary Queues Write token: "; printf '\n'
  read -r "target_kind?Target kind (square_webhook or outbox): "
  read -rs "target_id?Private synthetic event/outbox ID: "; printf '\n'
  printf '%s\n' "$cf_account_id" "$main_queue_id" "$dlq_id" "$queues_token" "$target_kind" "$target_id" |
    node scripts/manage-square-sandbox-dlq.mjs --inspect-only
)
```

Required inspect result is only:

```json
{"ok":true,"result_code":"DLQ_TARGET_MATCHED","matched_count":1}
```

Inspection does not authorize redrive. After the aggregate D1/Queue evidence is rechecked and the owner separately confirms the at-least-once step, rerun the same trapped input block with:

```sh
node scripts/manage-square-sandbox-dlq.mjs --execute-redrive --ack-at-least-once-redrive
```

Required submission result is `DLQ_REDRIVE_SUBMITTED`. That means only that Cloudflare accepted the main-Queue push and the exact DLQ purge request. It is not proof of processing. Require the main Queue consumer, D1 terminal state, zero duplicate business outcome, empty DLQ and full cleanup evidence before marking `Q-02` passed.

Immediately revoke the temporary token after the evidence window. Preserve any ambiguous result; do not purge the Queue, repeat a redrive blindly or edit D1 to make the case pass.
