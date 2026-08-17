const PUBLIC_CONTRACT = "spartan-square-offer-v1-2026-08-17";
const PRIVATE_CONTRACT = "spartan-square-connector-v1-2026-08-17";
const EXPECTED_SQUARE_VERSION = "2026-07-15";
const PROFILE_CONSENT_VERSION = "square-customer-profile-v1-2026-08-17";
const REFERENCE_PREFIX = "SPN1-";
const PASS_COOKIE = "spartan_square_pass";
const MAX_JSON_BYTES = 8 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const DEFAULT_PROCESSING_LEASE_SECONDS = 900;
const DEFAULT_PROCESSING_RECOVERY_LIMIT = 25;
const WEBHOOK_ENQUEUED_STALE_SECONDS = 1800;
const PRODUCTION_SQUARE_API_BASE = "https://connect.squareup.com";
const SANDBOX_SQUARE_API_BASE = "https://connect.squareupsandbox.com";
const PRODUCTION_LOCATION_ID = "3MDGSXS33HERT";
const encoder = new TextEncoder();

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/square/config") return await configRoute(request, env);
      if (url.pathname === "/api/square/offer") return await offerRoute(request, env);
      if (url.pathname === "/api/square/webhook") return await webhookRoute(request, env);
      if (url.pathname === "/api/square/pass") return await passRoute(request, env);
      return new Response("Not found", { status: 404, headers: securityHeaders() });
    } catch (error) {
      console.error("square_connector_unhandled", safeErrorCode(error));
      return errorJson("INTERNAL_ERROR", 500);
    }
  },

  async queue(batch, env, ctx) {
    if (!flag(env.SQUARE_CONSUMER_ENABLED)) {
      for (const message of batch.messages) message.retry({ delaySeconds: 300 });
      return;
    }
    for (const message of batch.messages) {
      try {
        await processQueueMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error("square_queue_error", safeErrorCode(error));
        if (isPermanent(error)) message.ack();
        else message.retry({ delaySeconds: retryDelay(message.attempts || 1) });
      }
    }
  },

  async scheduled(controller, env, ctx) {
    if (flag(env.SQUARE_CONSUMER_ENABLED)) ctx.waitUntil(maintainDeliveryQueues(env));
    if (flag(env.SQUARE_RECONCILIATION_ENABLED)) ctx.waitUntil(reconcileSquare(env));
    if (env.DB) ctx.waitUntil(cleanupExpiredPasses(env));
  },
};

async function configRoute(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (url.search) return errorJson("QUERY_NOT_ALLOWED", 400);
  const origin = request.headers.get("Origin");
  if (origin && !originAllowed(origin, env, url)) return errorJson("ORIGIN_NOT_ALLOWED", 403);
  const submissionId = String(request.headers.get("X-Spartan-Submission-Id") || "");
  const body = {
    ok: true,
    enabled: offerConfigured(env) && canaryEligible(submissionId, env),
    square_offer_contract_version: PUBLIC_CONTRACT,
    turnstile_site_key: String(env.TURNSTILE_SITE_KEY || ""),
  };
  return json(body, 200, origin ? corsHeaders(origin) : {});
}

async function offerRoute(request, env) {
  const url = new URL(request.url);
  if (request.method !== "POST") return methodNotAllowed("POST");
  const origin = request.headers.get("Origin");
  if (!origin || !originAllowed(origin, env, url)) return errorJson("ORIGIN_NOT_ALLOWED", 403);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") return errorJson("ORIGIN_NOT_ALLOWED", 403, origin);
  if (url.search) return offerErrorJson("QUERY_NOT_ALLOWED", 400, origin);
  if (!offerConfigured(env)) return offerErrorJson("OFFER_DISABLED", 503, origin);
  if (!contentTypeIs(request, "application/json")) return offerErrorJson("CONTENT_TYPE_REQUIRED", 415, origin);

  let payload;
  try {
    payload = await readJson(request, MAX_JSON_BYTES);
  } catch (error) {
    return offerErrorJson(error.code || "INVALID_JSON", error.status || 400, origin);
  }
  if (!exactObject(payload, ["submission_id", "coupon_code", "square_profile_consent", "turnstile_token"])) {
    return offerErrorJson("INVALID_REQUEST_FIELDS", 400, origin);
  }
  const { submission_id, coupon_code, square_profile_consent, turnstile_token } = payload;
  if (![submission_id, coupon_code, square_profile_consent, turnstile_token].every((value) => typeof value === "string")) {
    return offerErrorJson("INVALID_REQUEST_FIELDS", 400, origin);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(submission_id)) return offerErrorJson("INVALID_SUBMISSION_ID", 400, origin);
  if (!/^[A-Z0-9-]{2,40}$/.test(coupon_code)) return offerErrorJson("INVALID_COUPON_CODE", 400, origin);
  if (square_profile_consent !== "yes") return offerErrorJson("CONSENT_REQUIRED", 400, origin);
  if (turnstile_token.length < 10 || turnstile_token.length > 2048) return offerErrorJson("TURNSTILE_REQUIRED", 400, origin);
  if (!canaryEligible(submission_id, env)) return offerErrorJson("OFFER_NOT_AVAILABLE", 404, origin);

  const turnstile = await verifyTurnstile(turnstile_token, request, env);
  if (!turnstile.ok) return offerErrorJson("TURNSTILE_FAILED", 403, origin);

  try {
    const result = await provisionOffer({ submission_id, coupon_code }, env);
    const responseBody = {
      ok: true,
      offer_result: result.offerResult,
      pass_available: result.passAvailable,
      pass_url: "/api/square/pass",
      square_offer_contract_version: PUBLIC_CONTRACT,
    };
    const headers = { ...corsHeaders(origin) };
    if (result.cookie) headers["Set-Cookie"] = result.cookie;
    else headers["Set-Cookie"] = expiredPassCookie();
    return json(responseBody, 200, headers);
  } catch (error) {
    console.error("square_offer_error", safeErrorCode(error));
    if (error instanceof ConnectorError) return offerErrorJson(error.code, error.status, origin);
    return offerErrorJson("OFFER_TEMPORARILY_UNAVAILABLE", 503, origin);
  }
}

async function provisionOffer(input, env) {
  const now = new Date().toISOString();
  let claim = await dbFirst(env, "claim_by_submission", `
    SELECT * FROM offer_claims WHERE submission_id = ?1
  `, [input.submission_id]);

  if (!claim) {
    const claimId = crypto.randomUUID();
    const couponHash = await claimCouponHash(input.coupon_code, env);
    await dbRun(env, "claim_insert", `
      INSERT INTO offer_claims
        (claim_id, submission_id, coupon_code_hash, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'PENDING', ?4, ?4)
      ON CONFLICT(submission_id) DO NOTHING
    `, [claimId, input.submission_id, couponHash, now]);
    claim = await dbFirst(env, "claim_by_submission", `
      SELECT * FROM offer_claims WHERE submission_id = ?1
    `, [input.submission_id]);
  }
  if (!claim) throw new ConnectorError("CLAIM_LEDGER_UNAVAILABLE", 503);
  const suppliedCouponHash = await claimCouponHash(input.coupon_code, env);
  if (!timingSafeEqual(String(claim.coupon_code_hash || ""), suppliedCouponHash)) {
    throw new ConnectorError("CLAIM_COUPON_MISMATCH", 409);
  }

  if (claim.status === "READY") return withPass("already_ready", claim, env);
  if (claim.status === "REDEEMED") return noPass("already_redeemed");
  if (claim.status === "STAFF_LOOKUP_REQUIRED") return noPass("staff_lookup_required");
  if (claim.status === "SQUARE_READY") return finalizeSquareReady(claim, input, env);

  const lookup = await appsCall("offer_prepare", {
    submission_id: input.submission_id,
    coupon_code: input.coupon_code,
    square_customer_profile_consent: "yes",
    square_customer_profile_consent_version: PROFILE_CONSENT_VERSION,
  }, env);
  assertAppsResponse(lookup, "offer_prepare", input.submission_id);

  if (lookup.offer_prepare_result === "not_eligible") {
    await setClaimStatus(env, claim.claim_id, "REDEEMED");
    return noPass("already_redeemed");
  }
  if (!(["eligible", "already_linked"].includes(lookup.offer_prepare_result))) {
    throw new ConnectorError("APPS_CONTRACT_INVALID", 502);
  }
  if (typeof lookup.name !== "string" || typeof lookup.phone !== "string") {
    throw new ConnectorError("APPS_CONTRACT_INVALID", 502);
  }
  rejectEmailFields(lookup);
  const phone = normalizeUsPhone(lookup.phone);
  const personName = parseName(lookup.name);
  const identityHash = await identityPhoneHash(phone, env);
  const other = await dbFirst(env, "claim_by_identity", `
    SELECT * FROM offer_claims WHERE identity_hash = ?1 AND claim_id <> ?2
  `, [identityHash, claim.claim_id]);
  if (other) {
    await setClaimStatus(env, claim.claim_id, "STAFF_LOOKUP_REQUIRED");
    return noPass("staff_lookup_required");
  }

  await dbRun(env, "claim_identity", `
    UPDATE offer_claims
       SET identity_hash = ?1, status = 'PROVISIONING', updated_at = ?2
     WHERE claim_id = ?3 AND status IN ('PENDING', 'PROVISIONING')
  `, [identityHash, now, claim.claim_id]);

  const provisioned = await findOrCreateSquareCustomer({
    claimId: claim.claim_id,
    phone,
    name: personName,
    suppliedCustomerId: lookup.square_customer_id,
  }, env);
  if (provisioned.staffLookupRequired) {
    await setClaimStatus(env, claim.claim_id, "STAFF_LOOKUP_REQUIRED");
    return noPass("staff_lookup_required");
  }
  if (!provisioned.created) {
    try {
      if (await hasPriorLinkedCompletedOrder(provisioned.customer.id, env)) {
        await setClaimStatus(env, claim.claim_id, "STAFF_LOOKUP_REQUIRED");
        return noPass("staff_lookup_required");
      }
    } catch {
      await setClaimStatus(env, claim.claim_id, "STAFF_LOOKUP_REQUIRED");
      return noPass("staff_lookup_required");
    }
    const referenceResult = await ensureReference(
      provisioned.customer,
      claim.claim_id,
      lookup.offer_prepare_result === "already_linked",
      env,
    );
    if (!referenceResult) {
      await setClaimStatus(env, claim.claim_id, "STAFF_LOOKUP_REQUIRED");
      return noPass("staff_lookup_required");
    }
    provisioned.customer = referenceResult.customer;
    provisioned.referenceId = referenceResult.referenceId;
    provisioned.matchMethod = referenceResult.wasExisting ? "existing_spartan_reference" : "unique_phone";
  }

  const wasMember = Array.isArray(provisioned.customer.group_ids) && provisioned.customer.group_ids.includes(env.SQUARE_ELIGIBLE_GROUP_ID);
  if (!wasMember) await addCustomerToGroup(provisioned.customer.id, env.SQUARE_ELIGIBLE_GROUP_ID, env);
  const verifiedCustomer = await retrieveCustomer(provisioned.customer.id, env);
  const groupIds = Array.isArray(verifiedCustomer.group_ids) ? verifiedCustomer.group_ids : [];
  if (verifiedCustomer.reference_id !== provisioned.referenceId || normalizeUsPhone(verifiedCustomer.phone_number) !== phone || !groupIds.includes(env.SQUARE_ELIGIBLE_GROUP_ID)) {
    throw new ConnectorError("SQUARE_CUSTOMER_VERIFY_FAILED", 502);
  }

  const finalizeEvidence = {
    matchMethod: provisioned.matchMethod,
    groupMembershipStatus: wasMember ? "already_member" : "added",
    effectiveAt: new Date().toISOString(),
  };
  await dbRun(env, "claim_square_ready", `
    UPDATE offer_claims
       SET square_customer_id = ?1, reference_id = ?2, match_method = ?3,
           group_membership_status = ?4, finalize_effective_at = ?5,
           status = 'SQUARE_READY', updated_at = ?5
     WHERE claim_id = ?6 AND status IN ('PROVISIONING', 'SQUARE_READY')
  `, [provisioned.customer.id, provisioned.referenceId, finalizeEvidence.matchMethod,
    finalizeEvidence.groupMembershipStatus, finalizeEvidence.effectiveAt, claim.claim_id]);
  claim = { ...claim, square_customer_id: provisioned.customer.id, reference_id: provisioned.referenceId,
    match_method: finalizeEvidence.matchMethod, group_membership_status: finalizeEvidence.groupMembershipStatus,
    finalize_effective_at: finalizeEvidence.effectiveAt, status: "SQUARE_READY" };
  return finalizeSquareReady(claim, input, env);
}

async function finalizeSquareReady(claim, input, env) {
  if (!claim.square_customer_id || !validReference(claim.reference_id)) {
    await setClaimStatus(env, claim.claim_id, "STAFF_LOOKUP_REQUIRED");
    return noPass("staff_lookup_required");
  }
  if (!(["created", "unique_phone", "existing_spartan_reference"].includes(claim.match_method)) ||
      !(["added", "already_member"].includes(claim.group_membership_status)) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(String(claim.finalize_effective_at || ""))) {
    throw new ConnectorError("FINALIZE_EVIDENCE_MISSING", 503);
  }
  const finalized = await appsCall("offer_finalize", {
    website_submission_id: input.submission_id,
    coupon_code: input.coupon_code,
    square_customer_id: claim.square_customer_id,
    square_group_id: env.SQUARE_ELIGIBLE_GROUP_ID,
    group_membership_status: claim.group_membership_status,
    match_method: claim.match_method,
    match_confidence: "high",
    effective_at_utc: claim.finalize_effective_at,
  }, env);
  assertAppsResponse(finalized, "offer_finalize", input.submission_id);
  if (!(["linked", "already_linked"].includes(finalized.offer_finalize_result))) {
    throw new ConnectorError("APPS_FINALIZE_FAILED", 502);
  }
  const now = new Date().toISOString();
  await dbRun(env, "claim_ready", `
    UPDATE offer_claims
       SET status = 'READY', apps_ledger_status = 'READY', ready_at = COALESCE(ready_at, ?1), updated_at = ?1
     WHERE claim_id = ?2 AND status IN ('SQUARE_READY', 'READY')
  `, [now, claim.claim_id]);
  return withPass(finalized.offer_finalize_result === "already_linked" ? "already_ready" : "ready", { ...claim, status: "READY" }, env);
}

async function withPass(offerResult, claim, env) {
  if (!flag(env.SQUARE_PASS_ENABLED) || !env.PASS_SESSION_SECRET || !env.DB) return noPass(offerResult);
  const token = randomToken(32);
  const tokenHash = await keyedHash(env.PASS_SESSION_SECRET, `pass:${token}`);
  const now = new Date();
  const ttl = clampInt(env.PASS_SESSION_TTL_SECONDS, 2592000, 300, 7776000);
  const expires = new Date(now.getTime() + ttl * 1000);
  await dbRun(env, "pass_insert", `
    INSERT INTO pass_sessions (token_hash, claim_id, created_at, expires_at)
    VALUES (?1, ?2, ?3, ?4)
  `, [tokenHash, claim.claim_id, now.toISOString(), expires.toISOString()]);
  return {
    offerResult,
    passAvailable: true,
    cookie: `${PASS_COOKIE}=${token}; Path=/api/square/pass; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Strict`,
  };
}

function noPass(offerResult) {
  return { offerResult, passAvailable: false, cookie: null };
}

async function findOrCreateSquareCustomer(input, env) {
  if (input.suppliedCustomerId) {
    const customer = await retrieveCustomer(String(input.suppliedCustomerId), env);
    if (!squareCustomerMatches(customer, input.phone, input.name)) return { staffLookupRequired: true };
    return { customer, created: false };
  }

  const search = await squareRequest("POST", "/v2/customers/search", {
    query: { filter: { phone_number: { exact: input.phone } } },
    limit: 10,
  }, env);
  const customers = Array.isArray(search.customers) ? search.customers.filter((customer) => normalizePhoneSoft(customer.phone_number) === input.phone) : [];
  if (customers.length > 1) return { staffLookupRequired: true };
  if (customers.length === 1) {
    const customer = customers[0];
    if (!squareCustomerMatches(customer, input.phone, input.name)) return { staffLookupRequired: true };
    return { customer, created: false };
  }

  const referenceId = await referenceForClaim(input.claimId);
  const body = {
    idempotency_key: input.claimId,
    given_name: input.name.given,
    phone_number: input.phone,
    reference_id: referenceId,
  };
  if (input.name.family) body.family_name = input.name.family;
  const created = await squareRequest("POST", "/v2/customers", body, env);
  if (!created.customer?.id) throw new ConnectorError("SQUARE_CUSTOMER_CREATE_FAILED", 502);
  return { customer: created.customer, referenceId, matchMethod: "created", created: true };
}

async function hasPriorLinkedCompletedOrder(customerId, env) {
  const result = await squareRequest("POST", "/v2/orders/search", {
    location_ids: [env.SQUARE_LOCATION_ID],
    query: { filter: {
      customer_filter: { customer_ids: [customerId] },
      state_filter: { states: ["COMPLETED"] },
    } },
    limit: 1,
    return_entries: true,
  }, env);
  return (Array.isArray(result.order_entries) && result.order_entries.length > 0) ||
    (Array.isArray(result.orders) && result.orders.length > 0);
}

async function ensureReference(customer, claimId, allowPreviouslyLinkedReference, env) {
  const expectedReferenceId = await referenceForClaim(claimId);
  const existing = String(customer.reference_id || "");
  if (existing) {
    if (!validReference(existing) || (!allowPreviouslyLinkedReference && existing !== expectedReferenceId)) return null;
    return { customer, referenceId: existing, wasExisting: true };
  }
  const referenceId = expectedReferenceId;
  let version = customer.version;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const updated = await squareRequest("PUT", `/v2/customers/${encodeURIComponent(customer.id)}`, {
        reference_id: referenceId,
        version,
      }, env);
      if (!updated.customer?.id) throw new ConnectorError("SQUARE_CUSTOMER_UPDATE_FAILED", 502);
      return { customer: updated.customer, referenceId, wasExisting: false };
    } catch (error) {
      if (attempt === 0 && error instanceof SquareApiError && error.squareCode === "VERSION_MISMATCH") {
        const fresh = await retrieveCustomer(customer.id, env);
        if (fresh.reference_id) {
          const valid = validReference(fresh.reference_id) && (allowPreviouslyLinkedReference || fresh.reference_id === expectedReferenceId);
          return valid ? { customer: fresh, referenceId: fresh.reference_id, wasExisting: true } : null;
        }
        version = fresh.version;
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function addCustomerToGroup(customerId, groupId, env) {
  await squareRequest("PUT", `/v2/customers/${encodeURIComponent(customerId)}/groups/${encodeURIComponent(groupId)}`, {}, env);
}

async function retrieveCustomer(customerId, env) {
  const response = await squareRequest("GET", `/v2/customers/${encodeURIComponent(customerId)}`, null, env);
  if (!response.customer?.id) throw new ConnectorError("SQUARE_CUSTOMER_NOT_FOUND", 502);
  return response.customer;
}

async function passRoute(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (url.search) return new Response("Invalid request", { status: 400, headers: passSecurityHeaders() });
  if (!flag(env.SQUARE_PASS_ENABLED) || !secretReady(env.PASS_SESSION_SECRET) || !env.DB) {
    return new Response("Pass unavailable", { status: 404, headers: passSecurityHeaders() });
  }
  const token = cookieValue(request.headers.get("Cookie"), PASS_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    return new Response("Pass not found", { status: 404, headers: passSecurityHeaders() });
  }
  const tokenHash = await keyedHash(env.PASS_SESSION_SECRET, `pass:${token}`);
  const session = await dbFirst(env, "pass_get", `
    SELECT p.token_hash, p.expires_at, p.revoked_at, c.reference_id, c.status
      FROM pass_sessions p
      JOIN offer_claims c ON c.claim_id = p.claim_id
     WHERE p.token_hash = ?1
  `, [tokenHash]);
  if (!session || session.revoked_at || session.status !== "READY" || Date.parse(session.expires_at) <= Date.now() || !validReference(session.reference_id)) {
    return new Response("Pass expired", { status: 410, headers: passSecurityHeaders({
      "Set-Cookie": expiredPassCookie(),
    }) });
  }
  return new Response(renderPass(session.reference_id), {
    status: 200,
    headers: passSecurityHeaders({ "Content-Type": "text/html; charset=utf-8" }),
  });
}

async function webhookRoute(request, env) {
  const url = new URL(request.url);
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (url.search) return errorJson("QUERY_NOT_ALLOWED", 400);
  if (!flag(env.SQUARE_WEBHOOK_ENABLED) || !webhookConfigured(env)) return errorJson("WEBHOOK_DISABLED", 503);
  if (!contentTypeIs(request, "application/json")) return errorJson("CONTENT_TYPE_REQUIRED", 415);
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_WEBHOOK_BYTES) return errorJson("PAYLOAD_TOO_LARGE", 413);
  const rawBody = await request.text();
  if (encoder.encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) return errorJson("PAYLOAD_TOO_LARGE", 413);
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  const signatureOk = await verifySquareWebhookSignature(
    env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    rawBody,
    signature,
  );
  if (!signatureOk) return errorJson("INVALID_SIGNATURE", 403);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return errorJson("INVALID_JSON", 400);
  }
  const allowedTypes = new Set(["payment.created", "payment.updated", "refund.created", "refund.updated"]);
  if (!exactEventEnvelope(event) || !allowedTypes.has(event.type) || event.merchant_id !== env.SQUARE_MERCHANT_ID) {
    return errorJson("INVALID_EVENT", 400);
  }
  const eventId = event.event_id;
  const objectId = event.data.id;
  const now = new Date().toISOString();
  const minimal = JSON.stringify({ event_id: eventId, type: event.type, merchant_id: event.merchant_id, object_id: objectId });
  await dbRun(env, "webhook_insert", `
    INSERT INTO webhook_events
      (event_id, event_type, object_id, merchant_id, payload_json, state, available_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', NULL, ?6, ?6)
    ON CONFLICT(event_id) DO NOTHING
  `, [eventId, event.type, objectId, event.merchant_id, minimal, now]);
  const stored = await dbFirst(env, "webhook_get", `
    SELECT * FROM webhook_events WHERE event_id = ?1
  `, [eventId]);
  if (!stored) return errorJson("WEBHOOK_LEDGER_UNAVAILABLE", 503);
  if (["ENQUEUED", "PROCESSING", "PROCESSED", "IGNORED", "REJECTED"].includes(stored.state)) {
    return json({ ok: true }, 200);
  }
  if (!["PENDING", "RETRY"].includes(stored.state)) return errorJson("WEBHOOK_LEDGER_INVALID", 503);
  if (webhookDeliveryDue(stored, now)) await enqueueWebhookEvent(stored, env);
  return json({ ok: true }, 200);
}

async function enqueueWebhookEvent(event, env) {
  await env.SQUARE_QUEUE.send({ kind: "square_webhook", event_id: event.event_id }, { contentType: "json" });
  const sentAt = new Date().toISOString();
  return dbRun(env, "webhook_enqueued", `
    UPDATE webhook_events
       SET state = 'ENQUEUED', available_at = NULL, updated_at = ?1
     WHERE event_id = ?2 AND state = ?3
       AND updated_at = ?4
       AND (state <> 'RETRY' OR available_at IS NULL OR available_at <= ?1)
  `, [sentAt, event.event_id, event.state, event.updated_at]);
}

async function processQueueMessage(body, env) {
  if (!body || typeof body !== "object") throw permanent("QUEUE_MESSAGE_INVALID");
  if (body.kind === "square_webhook" && typeof body.event_id === "string") {
    await processWebhookEvent(body.event_id, env);
    return;
  }
  if (body.kind === "outbox" && typeof body.outbox_id === "string") {
    await processOutboxItem(body.outbox_id, env);
    return;
  }
  throw permanent("QUEUE_MESSAGE_INVALID");
}

async function processWebhookEvent(eventId, env) {
  const event = await dbFirst(env, "webhook_get", `
    SELECT * FROM webhook_events WHERE event_id = ?1
  `, [eventId]);
  if (!event || ["PROCESSED", "IGNORED", "REJECTED"].includes(event.state)) return;
  const leaseStartedAt = new Date().toISOString();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + processingLeaseSeconds(env) * 1000).toISOString();
  const acquired = await dbRun(env, "webhook_processing", `
    UPDATE webhook_events
       SET state = 'PROCESSING', attempts = attempts + 1, updated_at = ?1,
           available_at = NULL, lease_token = ?2, lease_expires_at = ?3
     WHERE event_id = ?4
       AND (
         state = 'ENQUEUED'
         OR state = 'PENDING'
         OR (state = 'RETRY' AND (available_at IS NULL OR available_at <= ?1))
         OR (state = 'PROCESSING' AND (lease_expires_at IS NULL OR lease_expires_at <= ?1))
       )
  `, [leaseStartedAt, leaseToken, leaseExpiresAt, eventId]);
  if (dbChanges(acquired) !== 1) return;
  event.state = "PROCESSING";
  event.attempts = Number(event.attempts || 0) + 1;
  event.lease_token = leaseToken;
  event.lease_expires_at = leaseExpiresAt;
  try {
    if (event.event_type === "payment.created" || event.event_type === "payment.updated") await processPaymentEvent(event, env);
    else if (event.event_type === "refund.created" || event.event_type === "refund.updated") await processRefundEvent(event, env);
    else await markWebhook(env, event, "IGNORED", "EVENT_TYPE_NOT_ACTIONABLE");
  } catch (error) {
    if (isPermanent(error)) {
      await markWebhook(env, event, "REJECTED", safeErrorCode(error));
      return;
    }
    await markWebhook(env, event, "RETRY", safeErrorCode(error));
    throw error;
  }
}

async function processPaymentEvent(event, env) {
  const paymentResponse = await squareRequest("GET", `/v2/payments/${encodeURIComponent(event.object_id)}`, null, env);
  const payment = paymentResponse.payment;
  if (!payment?.id) throw transient("PAYMENT_FETCH_INVALID");
  if (payment.status !== "COMPLETED") {
    await markWebhook(env, event, "IGNORED", "PAYMENT_NOT_COMPLETED");
    return;
  }
  if (payment.location_id !== env.SQUARE_LOCATION_ID) throw permanent("PAYMENT_WRONG_LOCATION");
  const waitForLinks = Number(event.attempts || 0) < 2;
  if (!payment.order_id) {
    if (waitForLinks) throw transient("PAYMENT_LINKS_NOT_READY");
    throw permanent("PAYMENT_ORDER_LINK_MISSING");
  }
  const orderResponse = await squareRequest("GET", `/v2/orders/${encodeURIComponent(payment.order_id)}`, null, env);
  const order = orderResponse.order;
  if (!order?.id || order.state !== "COMPLETED") throw transient("ORDER_NOT_READY");
  if (order.location_id !== env.SQUARE_LOCATION_ID) throw permanent("ORDER_WRONG_LOCATION");
  const targetDiscountPresent = orderHasTargetDiscount(order, env);
  if (!payment.customer_id) {
    if (!targetDiscountPresent) {
      await markWebhook(env, event, "IGNORED", "NORMAL_ORDER_WITHOUT_LINKED_CUSTOMER");
      return;
    }
    if (waitForLinks) throw transient("PAYMENT_CUSTOMER_NOT_READY");
    throw permanent("TARGET_DISCOUNT_WITHOUT_CUSTOMER");
  }
  if (order.customer_id !== payment.customer_id) throw permanent("ORDER_CUSTOMER_MISMATCH");
  const claim = await dbFirst(env, "claim_ready_by_customer", `
    SELECT * FROM offer_claims WHERE square_customer_id = ?1 AND status IN ('READY', 'REDEEMED')
  `, [payment.customer_id]);
  if (!claim) {
    if (!targetDiscountPresent) {
      await markWebhook(env, event, "IGNORED", "NORMAL_ORDER_WITH_UNLINKED_CUSTOMER");
      return;
    }
    if (waitForLinks) throw transient("CLAIM_NOT_READY");
    throw permanent("TARGET_DISCOUNT_UNLINKED_CUSTOMER");
  }
  const existingPurchase = await dbFirst(env, "purchase_by_order", `
    SELECT * FROM purchases WHERE square_order_id = ?1
  `, [order.id]);
  if (existingPurchase) {
    if (existingPurchase.claim_id !== claim.claim_id) throw permanent("ORDER_ALREADY_LINKED_DIFFERENT_CLAIM");
    await recordAdditionalTender(existingPurchase, payment, event, env);
    return;
  }
  if (!targetDiscountPresent) {
    await recordOrdinaryPurchase(claim, payment, order, event, env);
    return;
  }
  const existing = await dbFirst(env, "redemption_by_claim", `
    SELECT * FROM redemptions WHERE claim_id = ?1
  `, [claim.claim_id]);
  if (existing) {
    if (existing.square_order_id === payment.order_id) {
      await recordAdditionalTender({ purchase_id: `pur_${payment.order_id}`, claim_id: claim.claim_id,
        square_order_id: payment.order_id }, payment, event, env);
      return;
    }
    if (existing.square_payment_id !== payment.id || existing.square_order_id !== payment.order_id) {
      throw permanent("CLAIM_ALREADY_REDEEMED_DIFFERENT_ORDER");
    }
    await markWebhook(env, event, "PROCESSED", null);
    return;
  }
  if (claim.status !== "READY") throw permanent("CLAIM_NOT_READY");
  const inspection = inspectOrderForOffer(order, env);
  if (!inspection.ok) throw permanent(inspection.reason);
  const orderTotal = Number(order.net_amounts?.total_money?.amount);
  const orderCurrency = String(order.net_amounts?.total_money?.currency || "");
  const paymentAmount = Number(payment.amount_money?.amount);
  const netAmount = Number.isSafeInteger(orderTotal) && orderTotal > 0 ? orderTotal : paymentAmount;
  const paymentCurrency = orderCurrency || String(payment.amount_money?.currency || inspection.currency);
  if (!Number.isSafeInteger(netAmount) || netAmount <= 0 || paymentCurrency !== "USD" || paymentCurrency !== inspection.currency) {
    throw permanent("PAYMENT_AMOUNT_INVALID");
  }

  const now = new Date().toISOString();
  const redemptionId = `red_${payment.id}`;
  const removeOutboxId = `out_remove_${claim.claim_id}`;
  const appsOutboxId = `out_apps_redeem_${claim.claim_id}`;
  const outboxIds = [removeOutboxId, appsOutboxId];
  const statements = [
    dbStatement(env, "redemption_insert", `
      INSERT INTO redemptions
        (redemption_id, claim_id, square_payment_id, square_order_id, square_line_item_uid,
         square_discount_catalog_id, applied_discount_amount, currency, event_id, redeemed_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
       WHERE EXISTS (
         SELECT 1 FROM offer_claims WHERE claim_id = ?2 AND status = 'READY'
       )
         AND EXISTS (
           SELECT 1 FROM webhook_events
            WHERE event_id = ?9 AND state = 'PROCESSING' AND lease_token = ?11
              AND lease_expires_at > ?10
         )
      ON CONFLICT(claim_id) DO NOTHING
    `, [redemptionId, claim.claim_id, payment.id, order.id, inspection.lineItemUid,
      env.SQUARE_DISCOUNT_CATALOG_ID, inspection.amount, inspection.currency, event.event_id, now, event.lease_token]),
    dbStatement(env, "purchase_insert", `
      INSERT INTO purchases
        (purchase_id, claim_id, square_order_id, primary_payment_id, discount_qualification,
         net_amount, currency, event_id, occurred_at)
      SELECT ?1, ?2, ?3, ?4, 'qualified', ?5, ?6, ?7, ?8
       WHERE EXISTS (
         SELECT 1 FROM redemptions
          WHERE claim_id = ?2 AND square_order_id = ?3 AND event_id = ?7
       )
      ON CONFLICT(square_order_id) DO NOTHING
    `, [`pur_${order.id}`, claim.claim_id, order.id, payment.id, netAmount, paymentCurrency,
      event.event_id, payment.updated_at || payment.created_at || now]),
    dbStatement(env, "purchase_payment_insert", `
      INSERT INTO purchase_payments (square_payment_id, purchase_id, square_order_id, created_at)
      SELECT ?1, ?2, ?3, ?4
       WHERE EXISTS (
         SELECT 1 FROM purchases WHERE purchase_id = ?2 AND square_order_id = ?3
       )
      ON CONFLICT(square_payment_id) DO NOTHING
    `, [payment.id, `pur_${order.id}`, order.id, now]),
    dbStatement(env, "claim_redeemed", `
      UPDATE offer_claims
         SET status = 'REDEEMED', redeemed_at = COALESCE(redeemed_at, ?1), updated_at = ?1
       WHERE claim_id = ?2 AND status = 'READY'
         AND EXISTS (
           SELECT 1 FROM redemptions WHERE claim_id = ?2 AND square_order_id = ?3
         )
    `, [now, claim.claim_id, order.id]),
    dbStatement(env, "outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, 'PENDING', ?6, ?6, ?6
       WHERE EXISTS (
         SELECT 1 FROM redemptions WHERE claim_id = ?3 AND square_order_id = ?7
       )
      ON CONFLICT(dedupe_key) DO NOTHING
    `, [removeOutboxId, `remove-group:${claim.claim_id}`, claim.claim_id, "REMOVE_ELIGIBLE_GROUP",
      JSON.stringify({ square_customer_id: claim.square_customer_id }), now, order.id]),
    dbStatement(env, "outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, 'PENDING', ?6, ?6, ?6
       WHERE EXISTS (
         SELECT 1 FROM redemptions WHERE claim_id = ?3 AND square_order_id = ?7
       )
      ON CONFLICT(dedupe_key) DO NOTHING
    `, [appsOutboxId, `apps-redemption:${claim.claim_id}`, claim.claim_id, "APPS_RECORD_REDEMPTION",
      JSON.stringify({
        square_event_id: event.event_id,
        square_event_type: "payment_completed",
        occurred_at_utc: payment.updated_at || payment.created_at || now,
        square_customer_id: claim.square_customer_id,
        square_payment_id: payment.id,
        square_order_id: order.id,
        square_refund_id: "",
        square_location_id: env.SQUARE_LOCATION_ID,
        discount_qualification: "qualified",
        discount_catalog_object_id: env.SQUARE_DISCOUNT_CATALOG_ID,
        discount_name: inspection.discountName,
        discount_amount_minor: String(inspection.amount),
        net_amount_minor: String(netAmount),
        refund_amount_minor: "",
        currency: paymentCurrency,
        refund_scope: "",
      }), now, order.id]),
    dbStatement(env, "webhook_processed", `
      UPDATE webhook_events
         SET state = 'PROCESSED', last_error_code = NULL, payload_json = '{}', updated_at = ?1,
             available_at = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?2 AND state = 'PROCESSING' AND lease_token = ?3
         AND EXISTS (
           SELECT 1 FROM redemptions WHERE claim_id = ?4 AND square_order_id = ?5
         )
    `, [now, event.event_id, event.lease_token, claim.claim_id, order.id]),
  ];
  if (env.SQUARE_REDEEMED_GROUP_ID) {
    outboxIds.push(`out_add_redeemed_${claim.claim_id}`);
    statements.splice(5, 0, dbStatement(env, "outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, 'PENDING', ?6, ?6, ?6
       WHERE EXISTS (
         SELECT 1 FROM redemptions WHERE claim_id = ?3 AND square_order_id = ?7
       )
      ON CONFLICT(dedupe_key) DO NOTHING
    `, [`out_add_redeemed_${claim.claim_id}`, `add-redeemed:${claim.claim_id}`, claim.claim_id,
      "ADD_REDEEMED_GROUP", JSON.stringify({ square_customer_id: claim.square_customer_id }), now, order.id]));
  }
  const results = await env.DB.batch(statements);
  if (dbChanges(results[0]) !== 1) {
    const winner = await dbFirst(env, "redemption_by_claim", `
      SELECT * FROM redemptions WHERE claim_id = ?1
    `, [claim.claim_id]);
    if (winner?.square_order_id === order.id) return;
    if (winner) {
      await markWebhook(env, event, "REJECTED", "CLAIM_ALREADY_REDEEMED_DIFFERENT_ORDER");
      return;
    }
    throw transient("REDEMPTION_CAS_INDETERMINATE");
  }
  for (const outboxId of outboxIds) {
    try { await env.SQUARE_QUEUE.send({ kind: "outbox", outbox_id: outboxId }, { contentType: "json" }); }
    catch { /* The scheduled D1 outbox drain provides delivery recovery. */ }
  }
  // D1 is authoritative; direct enqueue is an optimization. The scheduled drain handles all pending rows.
}

async function recordOrdinaryPurchase(claim, payment, order, event, env) {
  const money = verifiedOrderMoney(order, payment);
  const now = new Date().toISOString();
  const purchaseId = `pur_${order.id}`;
  const outboxId = `out_apps_order_${order.id}`;
  await env.DB.batch([
    dbStatement(env, "purchase_insert", `
      INSERT INTO purchases
        (purchase_id, claim_id, square_order_id, primary_payment_id, discount_qualification,
         net_amount, currency, event_id, occurred_at)
      VALUES (?1, ?2, ?3, ?4, 'not_qualified', ?5, ?6, ?7, ?8)
      ON CONFLICT(square_order_id) DO NOTHING
    `, [purchaseId, claim.claim_id, order.id, payment.id, money.amount, money.currency,
      event.event_id, payment.updated_at || payment.created_at || now]),
    dbStatement(env, "purchase_payment_insert", `
      INSERT INTO purchase_payments (square_payment_id, purchase_id, square_order_id, created_at)
      VALUES (?1, ?2, ?3, ?4) ON CONFLICT(square_payment_id) DO NOTHING
    `, [payment.id, purchaseId, order.id, now]),
    dbStatement(env, "outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', ?6, ?6, ?6)
      ON CONFLICT(dedupe_key) DO NOTHING
    `, [outboxId, `apps-order:${order.id}`, claim.claim_id, "APPS_RECORD_PURCHASE", JSON.stringify({
      square_event_id: event.event_id,
      square_event_type: "payment_completed",
      occurred_at_utc: payment.updated_at || payment.created_at || now,
      square_customer_id: claim.square_customer_id,
      square_payment_id: payment.id,
      square_order_id: order.id,
      square_refund_id: "",
      square_location_id: env.SQUARE_LOCATION_ID,
      discount_qualification: "not_qualified",
      discount_catalog_object_id: "",
      discount_name: "",
      discount_amount_minor: "0",
      net_amount_minor: String(money.amount),
      refund_amount_minor: "",
      currency: money.currency,
      refund_scope: "",
    }), now]),
    dbStatement(env, "webhook_processed", `
      UPDATE webhook_events
         SET state = 'PROCESSED', last_error_code = NULL, payload_json = '{}', updated_at = ?1,
             available_at = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?2 AND state = 'PROCESSING' AND lease_token = ?3
    `, [now, event.event_id, event.lease_token]),
  ]);
  try { await env.SQUARE_QUEUE.send({ kind: "outbox", outbox_id: outboxId }, { contentType: "json" }); } catch { /* scheduled recovery */ }
}

async function recordAdditionalTender(purchase, payment, event, env) {
  const now = new Date().toISOString();
  await env.DB.batch([
    dbStatement(env, "purchase_payment_insert", `
      INSERT INTO purchase_payments (square_payment_id, purchase_id, square_order_id, created_at)
      VALUES (?1, ?2, ?3, ?4) ON CONFLICT(square_payment_id) DO NOTHING
    `, [payment.id, purchase.purchase_id, purchase.square_order_id, now]),
    dbStatement(env, "webhook_processed", `
      UPDATE webhook_events
         SET state = 'PROCESSED', last_error_code = 'SAME_ORDER_ADDITIONAL_TENDER', payload_json = '{}', updated_at = ?1,
             available_at = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?2 AND state = 'PROCESSING' AND lease_token = ?3
    `, [now, event.event_id, event.lease_token]),
  ]);
}

function verifiedOrderMoney(order, payment) {
  const orderAmount = Number(order.net_amounts?.total_money?.amount);
  const orderCurrency = String(order.net_amounts?.total_money?.currency || "");
  const paymentAmount = Number(payment.amount_money?.amount);
  const amount = Number.isSafeInteger(orderAmount) && orderAmount > 0 ? orderAmount : paymentAmount;
  const currency = orderCurrency || String(payment.amount_money?.currency || "");
  if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== "USD") throw permanent("ORDER_AMOUNT_INVALID");
  return { amount, currency };
}

async function processRefundEvent(event, env) {
  const response = await squareRequest("GET", `/v2/refunds/${encodeURIComponent(event.object_id)}`, null, env);
  const refund = response.refund;
  if (!refund?.id) throw transient("REFUND_FETCH_INVALID");
  if (refund.status !== "COMPLETED") {
    await markWebhook(env, event, "IGNORED", "REFUND_NOT_COMPLETED");
    return;
  }
  if (refund.location_id && refund.location_id !== env.SQUARE_LOCATION_ID) throw permanent("REFUND_WRONG_LOCATION");
  if (!refund.payment_id) throw transient("REFUND_PAYMENT_LINK_NOT_READY");
  const originalPaymentResponse = await squareRequest("GET", `/v2/payments/${encodeURIComponent(refund.payment_id)}`, null, env);
  const originalPayment = originalPaymentResponse.payment;
  if (!originalPayment?.id) throw transient("REFUND_PAYMENT_NOT_READY");
  const purchase = await dbFirst(env, "purchase_by_payment", `
    SELECT p.*, c.submission_id, c.square_customer_id, pp.square_payment_id AS refund_payment_id
      FROM purchase_payments pp
      JOIN purchases p ON p.purchase_id = pp.purchase_id
      JOIN offer_claims c ON c.claim_id = p.claim_id
     WHERE pp.square_payment_id = ?1
  `, [refund.payment_id]);
  if (!purchase) {
    if (originalPayment.location_id === env.SQUARE_LOCATION_ID && originalPayment.customer_id && originalPayment.order_id) {
      const linkedClaim = await dbFirst(env, "claim_ready_by_customer", `
        SELECT * FROM offer_claims WHERE square_customer_id = ?1 AND status IN ('READY', 'REDEEMED')
      `, [originalPayment.customer_id]);
      if (linkedClaim) throw transient("REFUND_WAITING_FOR_REDEMPTION");
    }
    await markWebhook(env, event, "IGNORED", "REFUND_NOT_OFFER_RELATED");
    return;
  }
  const amount = Number(refund.amount_money?.amount);
  const currency = String(refund.amount_money?.currency || "");
  if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== "USD") throw permanent("REFUND_AMOUNT_INVALID");
  if (!originalPayment?.id || originalPayment.customer_id !== purchase.square_customer_id ||
      originalPayment.order_id !== purchase.square_order_id || originalPayment.location_id !== env.SQUARE_LOCATION_ID ||
      originalPayment.amount_money?.currency !== currency) {
    throw permanent("REFUND_PAYMENT_MISMATCH");
  }
  const refundScope = amount >= Number(purchase.net_amount) ? "full" : "partial";
  const now = new Date().toISOString();
  await env.DB.batch([
    dbStatement(env, "refund_review_insert", `
      INSERT INTO refund_reviews
        (refund_id, claim_id, square_payment_id, square_order_id, amount, currency, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
      ON CONFLICT(refund_id) DO NOTHING
    `, [refund.id, purchase.claim_id, refund.payment_id, purchase.square_order_id,
      amount, currency, now]),
    dbStatement(env, "claim_refund_review", `
      UPDATE offer_claims SET refund_review_required = 1, updated_at = ?1 WHERE claim_id = ?2
    `, [now, purchase.claim_id]),
    dbStatement(env, "outbox_insert", `
      INSERT INTO square_outbox
        (outbox_id, dedupe_key, claim_id, action, payload_json, state, available_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', ?6, ?6, ?6)
      ON CONFLICT(dedupe_key) DO NOTHING
    `, [`out_refund_${refund.id}`, `apps-refund:${refund.id}`, purchase.claim_id,
      "APPS_RECORD_REFUND_REVIEW",
      JSON.stringify({
        square_event_id: event.event_id,
        square_event_type: "refund_completed",
        occurred_at_utc: refund.updated_at || refund.created_at || now,
        square_customer_id: purchase.square_customer_id,
        square_payment_id: purchase.primary_payment_id,
        square_order_id: purchase.square_order_id,
        square_refund_id: refund.id,
        square_location_id: env.SQUARE_LOCATION_ID,
        discount_qualification: "",
        discount_catalog_object_id: "",
        discount_name: "",
        discount_amount_minor: "",
        net_amount_minor: "",
        refund_amount_minor: String(amount),
        currency,
        refund_scope: refundScope,
        connector_purchase_qualification: purchase.discount_qualification,
      }), now]),
    dbStatement(env, "webhook_processed", `
      UPDATE webhook_events
         SET state = 'PROCESSED', last_error_code = NULL, payload_json = '{}', updated_at = ?1,
             available_at = NULL, lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?2 AND state = 'PROCESSING' AND lease_token = ?3
    `, [now, event.event_id, event.lease_token]),
  ]);
  // Deliberately no eligible-group re-add and no automatic coupon reissue.
}

function inspectOrderForOffer(order, env) {
  const discounts = Array.isArray(order.discounts) ? order.discounts : [];
  const target = discounts.filter((discount) => discount.catalog_object_id === env.SQUARE_DISCOUNT_CATALOG_ID);
  if (target.length !== 1) return { ok: false, reason: "ORDER_DISCOUNT_NOT_EXACT" };
  if (discounts.length !== 1) return { ok: false, reason: "ORDER_DISCOUNT_STACKING_NOT_ALLOWED" };
  const discount = target[0];
  if (!discount.uid || discount.type !== "FIXED_PERCENTAGE" || Number(discount.percentage) !== 50 || discount.scope !== "LINE_ITEM") {
    return { ok: false, reason: "ORDER_DISCOUNT_CONFIGURATION_MISMATCH" };
  }
  const qualifyingIds = csvSet(env.SQUARE_QUALIFYING_VARIATION_IDS);
  if (qualifyingIds.size === 0) return { ok: false, reason: "QUALIFYING_CATALOG_NOT_CONFIGURED" };
  const applications = [];
  for (const line of Array.isArray(order.line_items) ? order.line_items : []) {
    for (const applied of Array.isArray(line.applied_discounts) ? line.applied_discounts : []) {
      if (applied.discount_uid !== discount.uid) return { ok: false, reason: "ORDER_DISCOUNT_STACKING_NOT_ALLOWED" };
      if (applied.discount_uid === discount.uid) applications.push({ line, applied });
    }
  }
  if (applications.length !== 1) return { ok: false, reason: "ORDER_DISCOUNT_APPLICATION_COUNT_INVALID" };
  const { line, applied } = applications[0];
  if (!line.uid || !qualifyingIds.has(line.catalog_object_id)) return { ok: false, reason: "ORDER_ITEM_NOT_QUALIFYING" };
  if (!decimalIsOne(line.quantity)) return { ok: false, reason: "ORDER_ITEM_QUANTITY_NOT_ONE" };
  const amount = Number(applied.applied_money?.amount);
  const currency = String(applied.applied_money?.currency || "");
  if (!Number.isSafeInteger(amount) || amount <= 0 || currency !== "USD") return { ok: false, reason: "ORDER_DISCOUNT_AMOUNT_INVALID" };
  return { ok: true, lineItemUid: line.uid, amount, currency, discountName: String(discount.name || "50% Off First Drink — Enter 50%") };
}

function orderHasTargetDiscount(order, env) {
  return (Array.isArray(order?.discounts) ? order.discounts : [])
    .some((discount) => discount?.catalog_object_id === env.SQUARE_DISCOUNT_CATALOG_ID);
}

async function maintainDeliveryQueues(env) {
  if (!env.DB || !env.SQUARE_QUEUE) return;
  await recoverStaleProcessing(env);
  await enqueueRecoveredWebhookEvents(env);
  await drainOutbox(env);
}

async function recoverStaleProcessing(env) {
  const now = new Date().toISOString();
  const limit = processingRecoveryLimit(env);
  const webhookRows = await dbAll(env, "webhook_stale_processing", `
    SELECT event_id, lease_token FROM webhook_events
     WHERE state = 'PROCESSING'
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?1)
     ORDER BY updated_at ASC LIMIT ?2
  `, [now, limit]);
  for (const row of webhookRows) {
    await dbRun(env, "webhook_reclaim_processing", `
      UPDATE webhook_events
         SET state = 'RETRY', available_at = ?1,
             last_error_code = 'STALE_PROCESSING_LEASE', updated_at = ?1,
             lease_token = NULL, lease_expires_at = NULL
       WHERE event_id = ?2 AND state = 'PROCESSING'
         AND lease_token IS ?3
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?1)
    `, [now, row.event_id, row.lease_token ?? null]);
  }

  const outboxRows = await dbAll(env, "outbox_stale_processing", `
    SELECT outbox_id, lease_token FROM square_outbox
     WHERE state = 'PROCESSING'
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?1)
     ORDER BY updated_at ASC LIMIT ?2
  `, [now, limit]);
  for (const row of outboxRows) {
    await dbRun(env, "outbox_reclaim_processing", `
      UPDATE square_outbox
         SET state = 'RETRY', available_at = ?1, last_error_code = 'STALE_PROCESSING_LEASE', updated_at = ?1,
             lease_token = NULL, lease_expires_at = NULL
       WHERE outbox_id = ?2 AND state = 'PROCESSING'
         AND lease_token IS ?3
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?1)
    `, [now, row.outbox_id, row.lease_token ?? null]);
  }
}

async function enqueueRecoveredWebhookEvents(env) {
  const now = new Date().toISOString();
  const enqueuedCutoff = new Date(Date.now() - WEBHOOK_ENQUEUED_STALE_SECONDS * 1000).toISOString();
  const result = await dbAll(env, "webhook_recovery_pending", `
    SELECT event_id, state FROM webhook_events
     WHERE state = 'PENDING'
        OR (state = 'RETRY' AND (available_at IS NULL OR available_at <= ?1))
        OR (state = 'ENQUEUED' AND updated_at <= ?2)
     ORDER BY updated_at ASC LIMIT ?3
  `, [now, enqueuedCutoff, processingRecoveryLimit(env)]);
  for (const row of result) {
    try {
      await env.SQUARE_QUEUE.send({ kind: "square_webhook", event_id: row.event_id }, { contentType: "json" });
      const sentAt = new Date().toISOString();
      await dbRun(env, "webhook_recovery_enqueued", `
        UPDATE webhook_events
         SET state = 'ENQUEUED', available_at = NULL, updated_at = ?1
         WHERE event_id = ?2 AND (
           state = 'PENDING'
           OR (state = 'RETRY' AND (available_at IS NULL OR available_at <= ?1))
           OR (state = 'ENQUEUED' AND updated_at <= ?3)
         )
      `, [sentAt, row.event_id, enqueuedCutoff]);
    } catch (error) {
      console.error("square_webhook_recovery_enqueue_error", safeErrorCode(error));
    }
  }
}

async function drainOutbox(env) {
  if (!env.DB || !env.SQUARE_QUEUE) return;
  const result = await dbAll(env, "outbox_pending", `
    SELECT outbox_id FROM square_outbox
     WHERE state IN ('PENDING', 'RETRY') AND available_at <= ?1
     ORDER BY created_at ASC LIMIT 25
  `, [new Date().toISOString()]);
  for (const row of result) {
    try {
      await env.SQUARE_QUEUE.send({ kind: "outbox", outbox_id: row.outbox_id }, { contentType: "json" });
    } catch (error) {
      console.error("square_outbox_enqueue_error", safeErrorCode(error));
    }
  }
}

async function cleanupExpiredPasses(env) {
  await dbRun(env, "pass_cleanup", `
    DELETE FROM pass_sessions WHERE expires_at <= ?1 OR revoked_at IS NOT NULL
  `, [new Date().toISOString()]);
}

async function processOutboxItem(outboxId, env) {
  const item = await dbFirst(env, "outbox_get", `
    SELECT * FROM square_outbox WHERE outbox_id = ?1
  `, [outboxId]);
  if (!item || item.state === "DONE" || item.state === "DEAD") return;
  const leaseStartedAt = new Date().toISOString();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(Date.now() + processingLeaseSeconds(env) * 1000).toISOString();
  const acquired = await dbRun(env, "outbox_processing", `
    UPDATE square_outbox
       SET state = 'PROCESSING', attempts = attempts + 1, updated_at = ?1,
           lease_token = ?2, lease_expires_at = ?3
     WHERE outbox_id = ?4
       AND (
         state IN ('PENDING', 'RETRY')
         OR (state = 'PROCESSING' AND (lease_expires_at IS NULL OR lease_expires_at <= ?1))
       )
  `, [leaseStartedAt, leaseToken, leaseExpiresAt, outboxId]);
  if (dbChanges(acquired) !== 1) return;
  item.state = "PROCESSING";
  item.attempts = Number(item.attempts || 0) + 1;
  item.lease_token = leaseToken;
  item.lease_expires_at = leaseExpiresAt;
  try {
    let payload;
    try { payload = JSON.parse(item.payload_json); } catch { throw permanent("OUTBOX_PAYLOAD_INVALID"); }
    if (item.action === "APPS_RECORD_REFUND_REVIEW") {
      const dependency = await dbFirst(env, "outbox_apps_redemption_state", `
        SELECT state FROM square_outbox
         WHERE claim_id = ?1 AND action = ?2
           AND dedupe_key = ?3
         LIMIT 1
      `, [item.claim_id,
        payload.connector_purchase_qualification === "qualified" ? "APPS_RECORD_REDEMPTION" : "APPS_RECORD_PURCHASE",
        payload.connector_purchase_qualification === "qualified"
          ? `apps-redemption:${item.claim_id}`
          : `apps-order:${payload.square_order_id}`]);
      if (!dependency) throw permanent("APPS_DEPENDENCY_MISSING");
      if (dependency.state === "DEAD") throw permanent("APPS_DEPENDENCY_DEAD");
      if (dependency.state !== "DONE") throw transient("APPS_DEPENDENCY_NOT_READY");
    }
    if (item.action === "REMOVE_ELIGIBLE_GROUP") {
      await squareRequest("DELETE", `/v2/customers/${encodeURIComponent(payload.square_customer_id)}/groups/${encodeURIComponent(env.SQUARE_ELIGIBLE_GROUP_ID)}`, null, env);
    } else if (item.action === "ADD_REDEEMED_GROUP") {
      if (env.SQUARE_REDEEMED_GROUP_ID) await addCustomerToGroup(payload.square_customer_id, env.SQUARE_REDEEMED_GROUP_ID, env);
    } else if (item.action === "APPS_RECORD_PURCHASE" || item.action === "APPS_RECORD_REDEMPTION" || item.action === "APPS_RECORD_REFUND_REVIEW") {
      const response = await appsCall("event_commit", payload, env);
      assertAppsResponse(response, "event_commit", "");
      validateAppsEventResponse(response, payload);
    } else {
      throw permanent("OUTBOX_ACTION_INVALID");
    }
    const done = await dbRun(env, "outbox_done", `
      UPDATE square_outbox
         SET state = 'DONE', last_error_code = NULL, updated_at = ?1,
             lease_token = NULL, lease_expires_at = NULL
       WHERE outbox_id = ?2 AND state = 'PROCESSING' AND lease_token = ?3
    `, [new Date().toISOString(), outboxId, leaseToken]);
    if (dbChanges(done) !== 1) throw transient("OUTBOX_PROCESSING_LEASE_LOST");
  } catch (error) {
    const attempts = Number(item.attempts || 0);
    const terminal = isPermanent(error) || attempts >= 10;
    const next = new Date(Date.now() + retryDelay(attempts) * 1000).toISOString();
    const released = await dbRun(env, "outbox_retry", `
      UPDATE square_outbox
         SET state = ?1, available_at = ?2, last_error_code = ?3, updated_at = ?4,
             lease_token = NULL, lease_expires_at = NULL
       WHERE outbox_id = ?5 AND state = 'PROCESSING' AND lease_token = ?6
    `, [terminal ? "DEAD" : "RETRY", next, safeErrorCode(error), new Date().toISOString(), outboxId, leaseToken]);
    if (dbChanges(released) !== 1) throw transient("OUTBOX_PROCESSING_LEASE_LOST");
    if (!terminal) throw error;
  }
}

async function reconcileSquare(env) {
  if (!webhookConfigured(env) || !env.SQUARE_QUEUE) return;
  const hours = clampInt(env.RECONCILIATION_LOOKBACK_HOURS, 96, 1, 168);
  const beginTime = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  await reconcileCollection("payment", "/v2/payments", beginTime, env);
  await reconcileCollection("refund", "/v2/refunds", beginTime, env);
  await dbRun(env, "connector_state_upsert", `
    INSERT INTO connector_state (state_key, state_value, updated_at) VALUES ('last_reconciliation', ?1, ?1)
    ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at
  `, [new Date().toISOString()]);
}

async function reconcileCollection(kind, path, beginTime, env) {
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      begin_time: beginTime,
      location_id: env.SQUARE_LOCATION_ID,
      sort_order: "DESC",
      limit: "100",
    });
    if (cursor) query.set("cursor", cursor);
    const response = await squareRequest("GET", `${path}?${query}`, null, env);
    const objects = kind === "payment" ? (response.payments || []) : (response.refunds || []);
    for (const object of objects) {
      if (object.status !== "COMPLETED" || !object.id) continue;
      const updated = object.updated_at || object.created_at || "unknown";
      const eventId = await reconciliationEventId(kind, object.id, updated);
      const eventType = kind === "payment" ? "payment.updated" : "refund.updated";
      const now = new Date().toISOString();
      await dbRun(env, "webhook_insert", `
        INSERT INTO webhook_events
          (event_id, event_type, object_id, merchant_id, payload_json, state, available_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, 'PENDING', NULL, ?6, ?6)
        ON CONFLICT(event_id) DO NOTHING
      `, [eventId, eventType, object.id, env.SQUARE_MERCHANT_ID,
        JSON.stringify({ event_id: eventId, type: eventType, merchant_id: env.SQUARE_MERCHANT_ID, object_id: object.id }), now]);
      const stored = await dbFirst(env, "webhook_get", `SELECT * FROM webhook_events WHERE event_id = ?1`, [eventId]);
      if (stored && ["PENDING", "RETRY"].includes(stored.state) && webhookDeliveryDue(stored, now)) {
        await enqueueWebhookEvent(stored, env);
      }
    }
    cursor = response.cursor || "";
    if (!cursor) break;
  }
  if (cursor) {
    await dbRun(env, "connector_state_upsert", `
      INSERT INTO connector_state (state_key, state_value, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at
    `, [`reconciliation_overflow_${kind}`, cursor, new Date().toISOString()]);
    throw transient("RECONCILIATION_PAGE_LIMIT");
  }
}

async function reconciliationEventId(kind, objectId, updatedAt) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${kind}:${objectId}:${updatedAt}`)));
  const compact = bytesBase64(digest.slice(0, 16)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `rec-${kind}-${compact}`;
}

const APPS_OPERATIONS = Object.freeze({
  offer_prepare: {
    responseMode: "square_offer_prepare_json",
    signedFields: ["operation", "submission_id", "coupon_code", "square_customer_profile_consent",
      "square_customer_profile_consent_version", "response_mode", "connector_contract_version",
      "connector_timestamp", "connector_nonce"],
  },
  offer_finalize: {
    responseMode: "square_offer_finalize_json",
    signedFields: ["operation", "website_submission_id", "coupon_code", "square_customer_id", "square_group_id",
      "group_membership_status", "match_method", "match_confidence", "effective_at_utc", "response_mode",
      "connector_contract_version", "connector_timestamp", "connector_nonce"],
  },
  event_commit: {
    responseMode: "square_event_commit_json",
    signedFields: ["operation", "square_event_id", "square_event_type", "occurred_at_utc", "square_customer_id",
      "square_payment_id", "square_order_id", "square_refund_id", "square_location_id", "discount_qualification",
      "discount_catalog_object_id", "discount_name", "discount_amount_minor", "net_amount_minor",
      "refund_amount_minor", "currency", "refund_scope", "response_mode", "connector_contract_version",
      "connector_timestamp", "connector_nonce"],
  },
});

async function appsCall(action, fields, env) {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SHARED_SECRET) throw new ConnectorError("APPS_NOT_CONFIGURED", 503);
  const operation = APPS_OPERATIONS[action];
  if (!operation) throw new ConnectorError("APPS_OPERATION_INVALID", 500);
  const values = {
    action,
    operation: action,
    response_mode: operation.responseMode,
    connector_contract_version: PRIVATE_CONTRACT,
    connector_timestamp: String(Math.floor(Date.now() / 1000)),
    connector_nonce: crypto.randomUUID(),
    ...fields,
  };
  const signed = {};
  for (const key of operation.signedFields) {
    const value = values[key] ?? "";
    if (typeof value !== "string") throw new ConnectorError("APPS_CONTRACT_INVALID", 500);
    signed[key] = value;
  }
  const unsignedBody = operation.signedFields.map((key) => `${key}=${encodeURIComponent(signed[key])}`).join("&");
  const signature = await hmacHex(env.APPS_SCRIPT_SHARED_SECRET, unsignedBody);
  const body = `${unsignedBody}&connector_signature=${encodeURIComponent(signature)}`;
  let response;
  try {
    response = await fetch(env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
      redirect: "follow",
    });
  } catch {
    throw transient("APPS_REQUEST_FAILED");
  }
  let text;
  try { text = await response.text(); } catch { throw transient("APPS_REQUEST_FAILED"); }
  if (encoder.encode(text).byteLength > 32 * 1024) throw new ConnectorError("APPS_RESPONSE_TOO_LARGE", 502);
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    if (!response.ok) throw transient("APPS_REQUEST_FAILED");
    throw new ConnectorError("APPS_RESPONSE_INVALID", 502);
  }
  rejectEmailFields(parsed);
  if (parsed?.ok === false) throw appsResponseError(action, parsed);
  if (!response.ok) throw transient("APPS_REQUEST_FAILED");
  return parsed;
}

function appsResponseError(action, response) {
  if (!exactObject(response, ["ok", "code", "connector_contract_version"]) ||
      response.connector_contract_version !== PRIVATE_CONTRACT || typeof response.code !== "string") {
    return new ConnectorError("APPS_CONTRACT_INVALID", 502);
  }
  const transientCode = `${action}_failed`;
  if (response.code === transientCode) return transient(`APPS_${action.toUpperCase()}_FAILED`);
  const permanentCodes = new Set(["connector_auth_failed", "square_journey_disabled", "square_journey_not_configured"]);
  if (permanentCodes.has(response.code)) return new ConnectorError("APPS_REQUEST_REJECTED", 502);
  return new ConnectorError("APPS_CONTRACT_INVALID", 502);
}

function assertAppsResponse(response, action, submissionId) {
  const exactKeys = action === "offer_prepare"
    ? ["ok", "operation", "offer_prepare_result", "profile_consent_result", "website_submission_id", "coupon_code",
      "name", "phone", "square_customer_id", "identity_link_id", "connector_contract_version"]
    : action === "offer_finalize"
      ? ["ok", "operation", "offer_finalize_result", "website_submission_id", "coupon_code", "square_customer_id",
        "identity_link_id", "contact_id", "identity_event_id", "connector_contract_version"]
      : null;
  if (!response || typeof response !== "object" || Array.isArray(response) || response.ok !== true ||
      response.connector_contract_version !== PRIVATE_CONTRACT || response.operation !== action ||
      (exactKeys && !exactObject(response, exactKeys)) ||
      ((action === "offer_prepare" || action === "offer_finalize") && response.website_submission_id !== submissionId)) {
    throw new ConnectorError("APPS_CONTRACT_INVALID", 502);
  }
}

function validateAppsEventResponse(response, payload) {
  const exactKeys = ["ok", "operation", "event_commit_result", "square_event_type", "order_event_id",
    "redemption_event_id", "reversal_event_id", "redemption_result", "rows_appended", "connector_contract_version"];
  if (!exactObject(response, exactKeys) || !["committed", "duplicate"].includes(response.event_commit_result) ||
      response.square_event_type !== payload.square_event_type || !Number.isInteger(response.rows_appended) || response.rows_appended < 0 ||
      ![response.order_event_id, response.redemption_event_id, response.reversal_event_id].every((value) => typeof value === "string")) {
    throw new ConnectorError("APPS_EVENT_COMMIT_FAILED", 502);
  }
  const allowedResults = payload.square_event_type === "payment_completed"
    ? (payload.discount_qualification === "not_qualified"
      ? new Set(["not_qualified"])
      : new Set(["redeemed", "already_recorded"]))
    : (payload.connector_purchase_qualification === "not_qualified"
      ? new Set(["no_redemption_found"])
      : new Set(["refund_recorded", "reversed_no_reissue", "already_reversed_no_reissue"]));
  if (!allowedResults.has(response.redemption_result)) throw new ConnectorError("APPS_EVENT_LEDGER_DRIFT", 502);
}

function rejectEmailFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes("email")) throw new ConnectorError("APPS_EMAIL_FIELD_FORBIDDEN", 502);
    if (nested && typeof nested === "object") rejectEmailFields(nested);
  }
}

async function squareRequest(method, path, body, env) {
  if (!env.SQUARE_ACCESS_TOKEN) throw new ConnectorError("SQUARE_NOT_CONFIGURED", 503);
  if (env.SQUARE_API_VERSION !== EXPECTED_SQUARE_VERSION) throw new ConnectorError("SQUARE_VERSION_MISMATCH", 503);
  const base = configuredSquareApiBase(env);
  if (!base) throw new ConnectorError("SQUARE_ENVIRONMENT_MISMATCH", 503);
  const headers = {
    Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    "Square-Version": EXPECTED_SQUARE_VERSION,
    Accept: "application/json",
  };
  const init = { method, headers };
  if (body !== null) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(`${base}${path}`, init); }
  catch { throw transient("SQUARE_NETWORK_ERROR"); }
  const text = await response.text();
  let parsed = {};
  if (text) {
    try { parsed = JSON.parse(text); } catch { throw transient("SQUARE_RESPONSE_INVALID"); }
  }
  if (!response.ok) {
    const code = parsed.errors?.[0]?.code || `HTTP_${response.status}`;
    const error = new SquareApiError(code, response.status);
    if (response.status >= 500 || response.status === 429) error.permanent = false;
    throw error;
  }
  return parsed;
}

async function verifyTurnstile(token, request, env) {
  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    idempotency_key: crypto.randomUUID(),
  });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  let response;
  try {
    response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: form.toString(),
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };
  let result;
  try { result = await response.json(); } catch { return { ok: false }; }
  const expectedAction = env.TURNSTILE_EXPECTED_ACTION || "square_offer";
  return {
    ok: result.success === true && result.action === expectedAction && result.hostname === new URL(request.url).hostname,
  };
}

async function verifySquareWebhookSignature(secret, notificationUrl, rawBody, supplied) {
  if (!secret || !notificationUrl || !supplied) return false;
  const expected = await hmacBase64(secret, `${notificationUrl}${rawBody}`);
  return timingSafeEqual(expected, supplied);
}

function exactEventEnvelope(event) {
  return Boolean(event && typeof event === "object" && !Array.isArray(event) &&
    typeof event.event_id === "string" && event.event_id.length >= 8 && event.event_id.length <= 200 &&
    typeof event.type === "string" && typeof event.merchant_id === "string" &&
    event.data && typeof event.data === "object" && typeof event.data.id === "string" && event.data.id.length > 0);
}

function offerConfigured(env) {
  return flag(env.SQUARE_OFFER_ENABLED) && flag(env.SQUARE_PASS_ENABLED) &&
    flag(env.SQUARE_WEBHOOK_ENABLED) && flag(env.SQUARE_CONSUMER_ENABLED) && webhookConfigured(env) && Boolean(
    connectorEnvironmentConfigured(env) && env.DB && env.SQUARE_ACCESS_TOKEN && env.SQUARE_API_VERSION === EXPECTED_SQUARE_VERSION &&
    env.SQUARE_LOCATION_ID && env.SQUARE_DISCOUNT_CATALOG_ID && env.SQUARE_ELIGIBLE_GROUP_ID &&
    csvSet(env.SQUARE_QUALIFYING_VARIATION_IDS).size > 0 && env.TURNSTILE_SITE_KEY &&
    env.TURNSTILE_SECRET_KEY && secretReady(env.D1_HASH_SECRET) && secretReady(env.PASS_SESSION_SECRET) &&
    env.APPS_SCRIPT_URL && secretReady(env.APPS_SCRIPT_SHARED_SECRET),
  );
}

function canaryEligible(submissionId, env) {
  if (!flag(env.SQUARE_CANARY_ONLY)) return true;
  return Boolean(submissionId) && csvSet(env.SQUARE_CANARY_SUBMISSION_IDS).has(submissionId);
}

function webhookConfigured(env) {
  return Boolean(connectorEnvironmentConfigured(env) && env.DB && env.SQUARE_QUEUE && env.SQUARE_ACCESS_TOKEN &&
    env.SQUARE_API_VERSION === EXPECTED_SQUARE_VERSION && env.SQUARE_LOCATION_ID &&
    env.SQUARE_DISCOUNT_CATALOG_ID && env.SQUARE_ELIGIBLE_GROUP_ID &&
    csvSet(env.SQUARE_QUALIFYING_VARIATION_IDS).size > 0 && env.SQUARE_MERCHANT_ID &&
    env.SQUARE_WEBHOOK_SIGNATURE_KEY && env.SQUARE_WEBHOOK_NOTIFICATION_URL);
}

function configuredSquareApiBase(env) {
  const connectorEnvironment = String(env.CONNECTOR_ENVIRONMENT || "").trim().toLowerCase();
  const squareEnvironment = String(env.SQUARE_ENVIRONMENT || "").trim().toLowerCase();
  const base = String(env.SQUARE_API_BASE_URL || "").replace(/\/$/, "");
  const locationId = String(env.SQUARE_LOCATION_ID || "");
  if (connectorEnvironment !== squareEnvironment) return "";
  if (squareEnvironment === "production") {
    return base === PRODUCTION_SQUARE_API_BASE && locationId === PRODUCTION_LOCATION_ID ? base : "";
  }
  if (squareEnvironment === "sandbox") {
    return base === SANDBOX_SQUARE_API_BASE && locationId !== PRODUCTION_LOCATION_ID &&
      locationId.length > 0 && !isPlaceholder(locationId) ? base : "";
  }
  return "";
}

function connectorEnvironmentConfigured(env) {
  const base = configuredSquareApiBase(env);
  if (!base) return false;
  const mode = String(env.CONNECTOR_ENVIRONMENT || "").trim().toLowerCase();
  const notification = safeUrl(env.SQUARE_WEBHOOK_NOTIFICATION_URL);
  if (!notification || notification.protocol !== "https:" || notification.pathname !== "/api/square/webhook" ||
      notification.search || notification.hash) return false;
  const origins = csvSet(env.ALLOWED_ORIGINS);
  if (mode === "production") {
    return notification.href === "https://spartandrink.com/api/square/webhook" &&
      origins.has("https://spartandrink.com") && origins.has("https://www.spartandrink.com") && origins.size === 2;
  }
  if (mode === "sandbox") {
    const hostname = notification.hostname.toLowerCase();
    return hostname.endsWith(".workers.dev") && !hostname.startsWith("replace-with-") &&
      notification.origin !== "https://spartandrink.com" && notification.origin !== "https://www.spartandrink.com" &&
      origins.size === 1 && origins.has(notification.origin);
  }
  return false;
}

function safeUrl(value) {
  try { return new URL(String(value || "")); } catch { return null; }
}

function isPlaceholder(value) {
  return /^REPLACE_WITH_/i.test(String(value || ""));
}

function originAllowed(origin, env, url) {
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== "https:") return false;
  } catch { return false; }
  return csvSet(env.ALLOWED_ORIGINS).has(origin) && origin === url.origin;
}

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function readJson(request, maxBytes) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) throw requestError("PAYLOAD_TOO_LARGE", 413);
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) throw requestError("PAYLOAD_TOO_LARGE", 413);
  try { return JSON.parse(text); } catch { throw requestError("INVALID_JSON", 400); }
}

function contentTypeIs(request, expected) {
  return String(request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase() === expected;
}

function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) throw new ConnectorError("PHONE_REQUIRES_STAFF_REVIEW", 409);
  return `+1${ten}`;
}

function normalizePhoneSoft(value) {
  try { return normalizeUsPhone(value); } catch { return ""; }
}

function parseName(value) {
  const cleaned = String(value || "").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 120 || /[<>\r\n]/.test(cleaned)) throw new ConnectorError("NAME_REQUIRES_STAFF_REVIEW", 409);
  const parts = cleaned.split(" ");
  return { given: parts.shift(), family: parts.join(" ") };
}

function squareCustomerMatches(customer, phone, name) {
  if (!customer?.id || normalizePhoneSoft(customer.phone_number) !== phone) return false;
  const expected = canonicalName(`${name.given} ${name.family}`);
  const actual = canonicalName(`${customer.given_name || ""} ${customer.family_name || ""}`);
  return Boolean(expected && actual && expected === actual);
}

function canonicalName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

async function referenceForClaim(claimId) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`spartan-square-reference:${claimId}`)));
  const compact = bytesBase64(digest.slice(0, 16)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${REFERENCE_PREFIX}${compact}`;
}

function validReference(value) {
  return typeof value === "string" && /^SPN1-[A-Za-z0-9_-]{22}$/.test(value) && value.length <= 255;
}

function decimalIsOne(value) {
  return /^1(?:\.0+)?$/.test(String(value || ""));
}

function canonicalForm(fields) {
  return Object.keys(fields).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(fields[key])}`).join("&");
}

async function hmacBytes(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(String(value))));
}

async function hmacHex(secret, value) {
  return [...await hmacBytes(secret, value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64(secret, value) {
  return bytesBase64(await hmacBytes(secret, value));
}

async function keyedHash(secret, value) {
  return hmacHex(secret, value);
}

async function claimCouponHash(couponCode, env) {
  return keyedHash(env.D1_HASH_SECRET, `coupon:${couponCode}`);
}

async function identityPhoneHash(phone, env) {
  return keyedHash(env.D1_HASH_SECRET, `phone:${phone}`);
}

function bytesBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) mismatch |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return mismatch === 0;
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

function csvSet(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function flag(value) { return value === true || String(value).toLowerCase() === "true"; }
function secretReady(value) { return encoder.encode(String(value || "")).byteLength >= 32; }
function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function processingLeaseSeconds(env) {
  return clampInt(env.PROCESSING_LEASE_SECONDS, DEFAULT_PROCESSING_LEASE_SECONDS, 300, 3600);
}

function processingRecoveryLimit(env) {
  return clampInt(env.PROCESSING_RECOVERY_LIMIT, DEFAULT_PROCESSING_RECOVERY_LIMIT, 1, 100);
}

function dbChanges(result) {
  const changes = Number(result?.meta?.changes);
  return Number.isFinite(changes) ? changes : 0;
}

function corsHeaders(origin) {
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function securityHeaders(extra = {}) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extra,
  };
}

function passSecurityHeaders(extra = {}) {
  return securityHeaders({
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
    ...extra,
  });
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders({ "Content-Type": "application/json; charset=utf-8", ...headers }),
  });
}

function errorJson(code, status, origin = "") {
  return json({ ok: false, error_code: code }, status, origin ? corsHeaders(origin) : {});
}

function offerErrorJson(code, status, origin) {
  return json({ ok: false, error_code: code }, status, {
    ...corsHeaders(origin),
    "Set-Cookie": expiredPassCookie(),
  });
}

function expiredPassCookie() {
  return `${PASS_COOKIE}=; Path=/api/square/pass; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function methodNotAllowed(allow) {
  return json({ ok: false, error_code: "METHOD_NOT_ALLOWED" }, 405, { Allow: allow });
}

function requestError(code, status) { const error = new Error(code); error.code = code; error.status = status; return error; }
function retryDelay(attempts) { return Math.min(3600, 30 * (2 ** Math.min(7, Math.max(0, attempts - 1)))); }
function webhookDeliveryDue(event, now) {
  if (event?.state === "PENDING") return true;
  if (event?.state !== "RETRY") return false;
  if (!event.available_at) return true;
  const availableAt = Date.parse(event.available_at);
  return Number.isFinite(availableAt) && availableAt <= Date.parse(now);
}

class ConnectorError extends Error {
  constructor(code, status = 500, permanentValue = true) {
    super(code); this.name = "ConnectorError"; this.code = code; this.status = status; this.permanent = permanentValue;
  }
}

class SquareApiError extends ConnectorError {
  constructor(squareCode, httpStatus) {
    super("SQUARE_API_ERROR", httpStatus >= 500 || httpStatus === 429 ? 503 : 502, httpStatus < 500 && httpStatus !== 429);
    this.squareCode = squareCode;
  }
}

function permanent(code) { return new ConnectorError(code, 422, true); }
function transient(code) { return new ConnectorError(code, 503, false); }
function isPermanent(error) { return error?.permanent === true; }
function safeErrorCode(error) { return error?.code || error?.name || "UNKNOWN_ERROR"; }

function dbStatement(env, op, sql, values = []) {
  return env.DB.prepare(`/*op:${op}*/ ${sql}`).bind(...values);
}

async function dbFirst(env, op, sql, values = []) {
  return env.DB.prepare(`/*op:${op}*/ ${sql}`).bind(...values).first();
}

async function dbRun(env, op, sql, values = []) {
  return env.DB.prepare(`/*op:${op}*/ ${sql}`).bind(...values).run();
}

async function dbAll(env, op, sql, values = []) {
  const result = await env.DB.prepare(`/*op:${op}*/ ${sql}`).bind(...values).all();
  return result?.results || [];
}

async function setClaimStatus(env, claimId, status) {
  await dbRun(env, "claim_status", `
    UPDATE offer_claims SET status = ?1, updated_at = ?2 WHERE claim_id = ?3
  `, [status, new Date().toISOString(), claimId]);
}

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212",
  "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321",
  "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function code128Svg(value) {
  if (!validReference(value)) throw new ConnectorError("REFERENCE_INVALID", 500);
  const codes = [104, ...[...value].map((character) => character.charCodeAt(0) - 32)];
  let checksum = 104;
  for (let index = 1; index < codes.length; index += 1) checksum += codes[index] * index;
  codes.push(checksum % 103, 106);
  const quiet = 10;
  const moduleWidth = 1;
  const barHeight = 84;
  let moduleX = quiet;
  let rectangles = "";
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) throw new ConnectorError("BARCODE_ENCODING_FAILED", 500);
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]);
      if (index % 2 === 0) rectangles += `<rect x="${moduleX * moduleWidth}" y="0" width="${width * moduleWidth}" height="${barHeight}"/>`;
      moduleX += width;
    }
  }
  const totalWidth = (moduleX + quiet) * moduleWidth;
  return `<svg role="img" aria-label="Spartan offer scan code" viewBox="0 0 ${totalWidth} ${barHeight}" width="${totalWidth}" height="${barHeight}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rectangles}</g></svg>`;
}

function renderPass(referenceId) {
  const safeReference = escapeHtml(referenceId);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Spartan Nutrition checkout profile code</title>
<style>html{color-scheme:light}body{margin:0;background:#f4f1e9;color:#15231c;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.card{background:#fff;border:2px solid #173f2a;border-radius:20px;box-shadow:0 12px 36px #0002;margin:12px;max-width:680px;padding:clamp(18px,5vw,28px);text-align:center}.eyebrow{font-size:.78rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.code{background:#fff;border:1px solid #d6d6d6;border-radius:12px;margin:20px auto 12px;max-width:100%;overflow:hidden;padding:12px}.code svg{display:block;height:auto;margin:auto;max-width:100%;width:100%}.reference{font-family:ui-monospace,monospace;font-size:.92rem;font-weight:800;letter-spacing:.05em;overflow-wrap:anywhere}.note{color:#45534c;font-size:.92rem;line-height:1.5}</style>
</head><body><main class="card"><p class="eyebrow">Spartan Nutrition</p><h1>Checkout profile code</h1><p>Save or screenshot this code, then show it to a team member before checkout.</p><div class="code">${code128Svg(referenceId)}</div><p class="reference">${safeReference}</p><p class="note">A team member must confirm your current first-visit eligibility before applying “50% Off First Drink — Enter 50%” to one qualifying drink.</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function markWebhook(env, event, state, errorCode) {
  const now = new Date().toISOString();
  const availableAt = state === "RETRY"
    ? new Date(Date.parse(now) + retryDelay(Number(event.attempts || 1)) * 1000).toISOString()
    : null;
  const result = await dbRun(env, "webhook_mark", `
    UPDATE webhook_events
       SET state = ?1, last_error_code = ?2,
           available_at = ?3,
           payload_json = CASE WHEN ?1 IN ('PROCESSED', 'IGNORED', 'REJECTED') THEN '{}' ELSE payload_json END,
           updated_at = ?4,
           lease_token = NULL, lease_expires_at = NULL
     WHERE event_id = ?5 AND state = 'PROCESSING' AND lease_token = ?6
  `, [state, errorCode, availableAt, now, event.event_id, event.lease_token]);
  if (dbChanges(result) !== 1) throw transient("WEBHOOK_PROCESSING_LEASE_LOST");
}

export const __test = Object.freeze({
  PUBLIC_CONTRACT,
  PRIVATE_CONTRACT,
  EXPECTED_SQUARE_VERSION,
  code128Svg,
  inspectOrderForOffer,
  normalizeUsPhone,
  validReference,
  verifySquareWebhookSignature,
  renderPass,
  processQueueMessage,
  provisionOffer,
  appsCall,
  claimCouponHash,
  identityPhoneHash,
  reconciliationEventId,
});
