(() => {
  "use strict";

  const navToggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  const couponDialog = document.getElementById("coupon-dialog");
  const couponFormStep = document.querySelector("[data-coupon-form-step]");
  const couponResult = document.querySelector("[data-coupon-result]");
  const couponCode = document.querySelector("[data-coupon-code]");
  const couponResultEyebrow = document.querySelector("[data-coupon-result-eyebrow]");
  const couponResultTitle = document.querySelector("[data-coupon-result-title]");
  const couponStateNotice = document.querySelector("[data-coupon-state-notice]");
  const couponResultInstruction = document.querySelector("[data-coupon-result-instruction]");
  const couponResultMessage = document.querySelector("[data-coupon-result-message]");
  const couponDiscoveryForm = document.querySelector("[data-coupon-discovery]");
  const couponDiscoveryStatus = document.querySelector("[data-discovery-status]");
  const couponDiscoverySkip = document.querySelector("[data-discovery-skip]");
  const squareOffer = document.querySelector("[data-square-offer]");
  const squareOfferForm = document.querySelector("[data-square-offer-form]");
  const squareOfferConsent = squareOfferForm?.querySelector('input[name="square_profile_consent"]');
  const squareOfferChallenge = document.querySelector("[data-square-offer-challenge]");
  const squareOfferStatus = document.querySelector("[data-square-offer-status]");
  const squareOfferPass = document.querySelector("[data-square-offer-pass]");
  const couponResultNextAction = document.querySelector(".coupon-next-actions a");
  const couponForm = document.getElementById("coupon-form");
  const updatesForm = document.getElementById("updates-form");
  const updatesStatus = document.getElementById("updates-status");
  const updatesConfirmation = document.querySelector("[data-updates-confirmation]");
  const updatesConfirmationTitle = document.querySelector("[data-updates-confirmation-title]");
  const updatesGrid = updatesConfirmation?.closest(".updates-grid");
  const year = document.getElementById("current-year");
  const productionHosts = ["spartandrink.com", "www.spartandrink.com"];
  const isPreviewMode = !productionHosts.includes(window.location.hostname);
  const expectedHandlerVersion = "spartan-forms-v3.2-2026-08-15";
  const expectedWorkerContractVersion = "spartan-worker-form-v1-2026-08-15";
  const acceptedNativeHandlerVersions = new Set([
    "spartan-forms-v3.1-2026-08-10",
    expectedHandlerVersion
  ]);
  const confirmationEndpoint = "/api/forms";
  const discoveryEndpoint = "/api/forms/discovery";
  const discoveryContractVersion = "spartan-discovery-v1-2026-08-16";
  const squareOfferConfigEndpoint = "/api/square/config";
  const squareOfferEndpoint = "/api/square/offer";
  const squareOfferContractVersion = "spartan-square-offer-v1-2026-08-17";
  const confirmationTimeoutMs = 30000;
  const squareOfferTimeoutMs = 45000;
  const pendingSubmissionMaxAge = 30 * 60 * 1000;
  const pendingKeys = {
    coupon: "spartanPendingCouponSubmission",
    updates: "spartanPendingUpdatesSubmission"
  };
  const resultParameterNames = [
    "coupon",
    "code",
    "updates",
    "submission_id",
    "handler_version",
    "filtered"
  ];
  const campaignParameterNames = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "utm_id",
    "utm_source_platform",
    "gclid",
    "dclid",
    "gbraid",
    "wbraid",
    "gad_source",
    "gad_campaignid",
    "fbclid",
    "msclkid"
  ];
  const clickIdentifierParameterNames = new Set([
    "gclid",
    "dclid",
    "gbraid",
    "wbraid",
    "gad_source",
    "gad_campaignid",
    "fbclid",
    "msclkid"
  ]);
  const formPayloadFieldNames = [
    "record_type",
    "submission_id",
    "form_id",
    "source_page",
    "referrer",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "company",
    "name",
    "phone",
    "email",
    "email_consent"
  ];
  const metaBlockedEvents = new Set([
    "discovery_source_saved",
    "square_offer_ready",
    "square_offer_fallback",
    "square_offer_pass_opened",
    "home_products_view",
    "home_delivery_click",
    "member_savings_click",
    "home_shipping_page_click",
    "product_interest_click"
  ]);
  const discoverySources = new Set([
    "google_search",
    "google_maps",
    "facebook",
    "instagram",
    "tiktok",
    "other_social_media",
    "friend_family",
    "drive_by_nearby",
    "community_event_local_group",
    "other"
  ]);
  let activeDiscoverySubmissionId = "";
  let activeSquareOfferSubmissionId = "";
  let activeSquareOfferCouponCode = "";
  let squareOfferTurnstileToken = "";
  let squareOfferTurnstileWidgetId = null;
  let squareOfferConfigPromise = null;
  let squareOfferConfigSubmissionId = "";
  let squareOfferGeneration = 0;

  const sanitizeCampaignValue = (name, value) => {
    const candidate = String(value || "").trim().slice(0, 180);
    if (!candidate || candidate.includes("@")) return "";
    if (!clickIdentifierParameterNames.has(name) && (candidate.match(/\d/g) || []).length >= 10) return "";
    return /^[a-zA-Z0-9._~-]+$/.test(candidate) ? candidate : "";
  };

  const analyticsPageLocation = () => {
    const current = new URL(window.location.href);
    const safe = new URL(`${current.origin}${current.pathname}`);
    campaignParameterNames.forEach((name) => {
      const value = sanitizeCampaignValue(name, current.searchParams.get(name));
      if (value) safe.searchParams.set(name, value);
    });
    safe.hash = current.hash;
    return safe.toString();
  };

  const attributionReferrer = () => {
    try {
      const referrer = new URL(document.referrer);
      if (!/^https?:$/.test(referrer.protocol)) return "";
      return `${referrer.origin}${referrer.pathname}`.slice(0, 500);
    } catch (error) {
      return "";
    }
  };

  const track = (eventName, details = {}) => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...details });

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, details);
    }

    if (typeof window.fbq === "function" && !metaBlockedEvents.has(eventName)) {
      window.fbq("trackCustom", eventName, details);
    }
  };

  const setNavOpen = (open) => {
    if (!navToggle || !nav) return;
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    nav.dataset.open = String(open);
  };

  navToggle?.addEventListener("click", () => {
    setNavOpen(navToggle.getAttribute("aria-expanded") !== "true");
  });

  nav?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });

  document.addEventListener("click", (event) => {
    if (!nav || !navToggle || nav.dataset.open !== "true") return;
    if (!nav.contains(event.target) && !navToggle.contains(event.target)) {
      setNavOpen(false);
    }
  });

  const couponResultContent = {
    success: {
      eyebrow: "Claim confirmed",
      title: "Your coupon is ready.",
      notice: "",
      instruction: "Save or screenshot this coupon and show it to staff when ordering."
    },
    duplicate: {
      eyebrow: "Existing claim found",
      title: "You already claimed this offer.",
      notice: "No new coupon was created.",
      instruction: "We did not create another coupon. If your original offer has not been redeemed, show this saved coupon to staff."
    },
    remembered: {
      eyebrow: "Saved claim found",
      title: "Your saved first-visit offer.",
      notice: "This is your original saved claim—not a new coupon.",
      instruction: "This is the same one-per-person offer saved on this device—not a new coupon. If it has not been redeemed, show it to staff."
    }
  };

  const resetDiscoveryPrompt = () => {
    activeDiscoverySubmissionId = "";
    if (!couponDiscoveryForm) return;
    couponDiscoveryForm.reset();
    couponDiscoveryForm.hidden = true;
    couponDiscoveryForm.removeAttribute("aria-busy");
    delete couponDiscoveryForm.dataset.complete;
    couponDiscoveryForm.querySelectorAll("input, button").forEach((control) => {
      control.disabled = false;
    });
    if (couponDiscoveryStatus) couponDiscoveryStatus.textContent = "";
  };

  const setSquareOfferButtonState = () => {
    const button = squareOfferForm?.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = !(squareOfferConsent?.checked && squareOfferTurnstileToken);
  };

  const resetSquareOffer = () => {
    squareOfferGeneration += 1;
    activeSquareOfferSubmissionId = "";
    activeSquareOfferCouponCode = "";
    squareOfferTurnstileToken = "";
    squareOffer?.setAttribute("hidden", "");
    squareOfferForm?.removeAttribute("aria-busy");
    squareOfferForm?.removeAttribute("hidden");
    if (squareOfferConsent) squareOfferConsent.checked = false;
    if (squareOfferStatus) squareOfferStatus.textContent = "";
    if (squareOfferPass) squareOfferPass.hidden = true;
    if (squareOfferTurnstileWidgetId !== null && window.turnstile?.reset) {
      window.turnstile.reset(squareOfferTurnstileWidgetId);
    }
    setSquareOfferButtonState();
  };

  const loadTurnstile = () => {
    if (window.turnstile?.render) return Promise.resolve(window.turnstile);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-spartan-turnstile]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.turnstile), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.spartanTurnstile = "true";
      script.addEventListener("load", () => resolve(window.turnstile), { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
  };

  const loadSquareOfferConfig = (submissionId) => {
    if (squareOfferConfigPromise && squareOfferConfigSubmissionId === submissionId) {
      return squareOfferConfigPromise;
    }
    squareOfferConfigSubmissionId = submissionId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), squareOfferTimeoutMs);
    squareOfferConfigPromise = fetch(squareOfferConfigEndpoint, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Spartan-Submission-Id": submissionId
      },
      signal: controller.signal
    }).then(async (response) => {
      const result = await response.json();
      const expectedKeys = [
        "enabled",
        "ok",
        "square_offer_contract_version",
        "turnstile_site_key"
      ];
      const actualKeys = result && typeof result === "object" && !Array.isArray(result)
        ? Object.keys(result).sort()
        : [];
      if (!response.ok
        || actualKeys.length !== expectedKeys.length
        || !expectedKeys.every((key, index) => actualKeys[index] === key)
        || result.ok !== true
        || typeof result.enabled !== "boolean"
        || typeof result.turnstile_site_key !== "string"
        || result.square_offer_contract_version !== squareOfferContractVersion) {
        throw new Error("Invalid Square offer configuration");
      }
      return result;
    }).catch(() => ({ enabled: false, turnstile_site_key: "" }))
      .finally(() => window.clearTimeout(timeout));
    return squareOfferConfigPromise;
  };

  const showSquareOfferOption = async (submissionId, code) => {
    if (!squareOffer || !squareOfferForm || !squareOfferChallenge) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(submissionId)) return;
    if (!/^[A-Za-z0-9-]{2,40}$/.test(code)) return;

    const requestGeneration = squareOfferGeneration;
    const config = await loadSquareOfferConfig(submissionId);
    if (requestGeneration !== squareOfferGeneration) return;
    if (!config.enabled || !config.turnstile_site_key) return;

    try {
      await loadTurnstile();
      if (requestGeneration !== squareOfferGeneration) return;
      if (!window.turnstile?.render) throw new Error("Turnstile unavailable");
      activeSquareOfferSubmissionId = submissionId;
      activeSquareOfferCouponCode = code;
      squareOffer.removeAttribute("hidden");
      if (squareOfferTurnstileWidgetId === null) {
        squareOfferTurnstileWidgetId = window.turnstile.render(squareOfferChallenge, {
          sitekey: config.turnstile_site_key,
          action: "square_offer",
          callback: (token) => {
            squareOfferTurnstileToken = String(token || "");
            setSquareOfferButtonState();
          },
          "expired-callback": () => {
            squareOfferTurnstileToken = "";
            setSquareOfferButtonState();
          },
          "error-callback": () => {
            squareOfferTurnstileToken = "";
            if (squareOfferStatus) squareOfferStatus.textContent = "The checkout-code check is unavailable. Your coupon still works; staff can find you by phone.";
            setSquareOfferButtonState();
          }
        });
      } else {
        window.turnstile.reset(squareOfferTurnstileWidgetId);
      }
      setSquareOfferButtonState();
    } catch (error) {
      resetSquareOffer();
    }
  };

  const showDiscoveryPrompt = (submissionId) => {
    if (!couponDiscoveryForm || !/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(submissionId)) return;
    couponDiscoveryForm.reset();
    couponDiscoveryForm.hidden = false;
    couponDiscoveryForm.removeAttribute("aria-busy");
    delete couponDiscoveryForm.dataset.complete;
    couponDiscoveryForm.querySelectorAll("input, button").forEach((control) => {
      control.disabled = false;
    });
    if (couponDiscoveryStatus) couponDiscoveryStatus.textContent = "";
    activeDiscoverySubmissionId = submissionId;
  };

  const showCouponResult = (code = "FIRST-VISIT", message = "", state = "success") => {
    resetDiscoveryPrompt();
    resetSquareOffer();
    const content = couponResultContent[state] || couponResultContent.success;
    couponFormStep?.setAttribute("hidden", "");
    couponResult?.removeAttribute("hidden");
    couponResult?.setAttribute("data-coupon-state", state);
    couponDialog?.setAttribute("aria-labelledby", "coupon-result-title");
    if (couponCode) couponCode.textContent = code;
    if (couponResultEyebrow) couponResultEyebrow.textContent = content.eyebrow;
    if (couponResultTitle) couponResultTitle.textContent = content.title;
    if (couponStateNotice) {
      couponStateNotice.textContent = content.notice;
      couponStateNotice.hidden = !content.notice;
    }
    if (couponResultInstruction) couponResultInstruction.textContent = content.instruction;
    if (couponResultMessage) {
      couponResultMessage.textContent = message;
      couponResultMessage.hidden = !message;
    }
  };

  const showCouponForm = () => {
    couponResult?.setAttribute("hidden", "");
    couponFormStep?.removeAttribute("hidden");
    couponDialog?.setAttribute("aria-labelledby", "coupon-title");
  };

  const focusCouponResult = () => {
    couponResult?.querySelector("[data-coupon-result-title]")?.focus({ preventScroll: true });
  };

  const showUpdatesConfirmation = () => {
    updatesForm?.setAttribute("hidden", "");
    updatesConfirmation?.removeAttribute("hidden");
    updatesGrid?.setAttribute("data-updates-confirmed", "true");
    const focusConfirmation = () => window.requestAnimationFrame(() => {
      updatesConfirmation?.scrollIntoView({ block: "start", behavior: "instant" });
      updatesConfirmationTitle?.focus({ preventScroll: true });
    });
    if (document.readyState === "complete") {
      focusConfirmation();
    } else {
      window.addEventListener("load", focusConfirmation, { once: true });
    }
  };

  const openCoupon = () => {
    if (!couponDialog) return;

    let rememberedCode = "";
    try {
      if (localStorage.getItem("spartanCouponClaimed") === "true") {
        rememberedCode = localStorage.getItem("spartanCouponCode") || "FIRST-VISIT";
      }
    } catch (error) {
      // Storage is only a convenience. A browser that blocks it must still be
      // able to claim and display a server-confirmed coupon.
    }

    if (rememberedCode) {
      showCouponResult(rememberedCode, "", "remembered");
    } else {
      showCouponForm();
    }

    if (!couponDialog.open) couponDialog.showModal();
    if (rememberedCode) focusCouponResult();
    document.body.classList.add("dialog-open");
    track("coupon_open");
  };

  const closeCoupon = () => {
    couponDialog?.close();
    document.body.classList.remove("dialog-open");
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setNavOpen(false);
    if (couponDialog?.open) closeCoupon();
  });

  document.querySelectorAll("[data-open-coupon]").forEach((button) => {
    button.addEventListener("click", openCoupon);
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", closeCoupon);
  });

  couponDialog?.addEventListener("click", (event) => {
    if (event.target === couponDialog) closeCoupon();
  });

  couponDialog?.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
  });

  const setReturnUrl = (form, resultKey) => {
    if (!form) return;
    const returnField = form.querySelector('input[name="return_url"]');
    if (!returnField) return;

    const url = new URL(window.location.href);
    url.search = "";
    url.hash = resultKey === "coupon" ? "first-visit" : "updates";
    returnField.value = url.toString();
  };

  const setAttributionFields = (form) => {
    if (!form) return;
    const params = new URLSearchParams(window.location.search);
    const values = {
      referrer: attributionReferrer(),
      utm_source: sanitizeCampaignValue("utm_source", params.get("utm_source")),
      utm_medium: sanitizeCampaignValue("utm_medium", params.get("utm_medium")),
      utm_campaign: sanitizeCampaignValue("utm_campaign", params.get("utm_campaign")),
      utm_content: sanitizeCampaignValue("utm_content", params.get("utm_content")),
      utm_term: sanitizeCampaignValue("utm_term", params.get("utm_term"))
    };

    Object.entries(values).forEach(([name, value]) => {
      let field = form.querySelector(`input[name="${name}"]`);
      if (!field) {
        field = document.createElement("input");
        field.type = "hidden";
        field.name = name;
        form.appendChild(field);
      }
      field.value = String(value).slice(0, 500);
    });
  };

  const ensureHiddenField = (form, name) => {
    let field = form?.querySelector(`input[name="${name}"]`);
    if (!field && form) {
      field = document.createElement("input");
      field.type = "hidden";
      field.name = name;
      form.appendChild(field);
    }
    return field;
  };

  const createSubmissionId = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();

    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(4);
      window.crypto.getRandomValues(values);
      return `sn-${Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("")}`;
    }

    return `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  };

  const storePendingSubmission = (kind, submissionId) => {
    try {
      sessionStorage.setItem(pendingKeys[kind], JSON.stringify({
        id: submissionId,
        createdAt: Date.now()
      }));
    } catch (error) {
      // The form can still submit if a browser blocks session storage. The
      // returned conversion simply will not be trusted or measured.
    }
  };

  const readPendingSubmission = (kind) => {
    try {
      const pending = JSON.parse(sessionStorage.getItem(pendingKeys[kind]) || "null");
      if (!pending || typeof pending.id !== "string" || !Number.isFinite(pending.createdAt)) return null;
      if (Date.now() - pending.createdAt > pendingSubmissionMaxAge) return null;
      return pending;
    } catch (error) {
      return null;
    }
  };

  const clearPendingSubmission = (kind) => {
    try {
      sessionStorage.removeItem(pendingKeys[kind]);
    } catch (error) {
      // Nothing else is required when storage is unavailable.
    }
  };

  const prepareSubmission = (form, kind) => {
    const field = ensureHiddenField(form, "submission_id");
    const existingId = String(field?.value || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
    const pending = readPendingSubmission(kind);
    if (existingId && (!pending || pending.id === existingId)) {
      storePendingSubmission(kind, existingId);
      return existingId;
    }
    if (!existingId && pending) {
      if (field) field.value = pending.id;
      return pending.id;
    }

    const submissionId = createSubmissionId();
    if (field) field.value = submissionId;
    storePendingSubmission(kind, submissionId);
    return submissionId;
  };

  const trackConfirmedOnce = (kind, submissionId, callback) => {
    const key = `spartanTracked:${kind}:${submissionId}`;
    let alreadyTracked = false;
    try {
      alreadyTracked = sessionStorage.getItem(key) === "true";
    } catch (error) {
      // A blocked storage read should not prevent this confirmed event.
    }

    if (alreadyTracked) return;
    callback();

    try {
      sessionStorage.setItem(key, "true");
    } catch (error) {
      // The callback has already run; do not call it twice when storage fails.
    }
  };

  setReturnUrl(couponForm, "coupon");
  setReturnUrl(updatesForm, "updates");
  setAttributionFields(couponForm);
  setAttributionFields(updatesForm);

  const setFormBusy = (form, busy, busyLabel) => {
    const button = form?.querySelector('button[type="submit"]');
    if (!button) return;
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
  };

  const setFallbackAvailable = (form, available) => {
    const fallback = form?.querySelector("[data-native-submit]");
    if (fallback) fallback.hidden = !available;
  };

  const nativeFallback = (form, kind) => {
    if (!form) return;
    prepareSubmission(form, kind);
    setReturnUrl(form, kind);
    setAttributionFields(form);
    form.submit();
  };

  document.querySelectorAll("[data-native-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest("form");
      const kind = form === couponForm ? "coupon" : "updates";
      nativeFallback(form, kind);
    });
  });

  const formPayload = (form) => {
    const data = new FormData(form);
    return Object.fromEntries(formPayloadFieldNames
      .filter((name) => data.has(name))
      .map((name) => [name, String(data.get(name))]));
  };

  const requestConfirmation = async (form) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), confirmationTimeoutMs);
    try {
      const response = await fetch(confirmationEndpoint, {
        method: "POST",
        credentials: "omit",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formPayload(form)),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !result || result.ok !== true) throw new Error("Unconfirmed form response");
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const responseMatches = (result, submissionId, recordType) => Boolean(
    result
    && result.handler_version === expectedHandlerVersion
    && result.worker_form_contract_version === expectedWorkerContractVersion
    && result.submission_id === submissionId
    && result.record_type === recordType
    && result.filtered !== true
  );

  const couponConfirmationMessage = (couponStatus, updatesResult) => {
    const messages = [];
    if (updatesResult === "requested") {
      messages.push("Check your inbox and confirm your email to finish joining Spartan Updates.");
    } else if (updatesResult === "pending") {
      messages.push("Your email permission was saved, but we could not send the confirmation email yet. Please try the Updates form again later.");
    } else if (updatesResult === "blocked") {
      messages.push("A newer email opt-out is on file, so no confirmation was sent. Use the Updates form again if you intentionally want to rejoin.");
    } else if (updatesResult === "duplicate") {
      messages.push("A Spartan Updates confirmation was previously requested for this email. Check your inbox or spam folder.");
    }
    return messages.join(" ");
  };

  const acceptCouponConfirmation = ({ couponStatus, code, updatesResult = "", submissionId }) => {
    const safeCode = String(code || "FIRST-VISIT").replace(/[^A-Z0-9-]/gi, "").slice(0, 24) || "FIRST-VISIT";
    try {
      localStorage.setItem("spartanCouponClaimed", "true");
      localStorage.setItem("spartanCouponCode", safeCode);
    } catch (error) {
      // A confirmed coupon must remain visible even when storage is blocked.
    }
    showCouponResult(
      safeCode,
      couponConfirmationMessage(couponStatus, updatesResult),
      couponStatus === "duplicate" ? "duplicate" : "success"
    );
    if (!couponDialog?.open) couponDialog?.showModal();
    focusCouponResult();
    document.body.classList.add("dialog-open");
    clearPendingSubmission("coupon");

    if (couponStatus === "success") {
      trackConfirmedOnce("coupon", submissionId, () => {
        if (typeof window.fbq === "function") {
          window.fbq("track", "Lead", { source: "coupon_confirmed" });
        }
        track("coupon_confirmed");
      });
      showDiscoveryPrompt(submissionId);
      showSquareOfferOption(submissionId, safeCode);
    }

    if (updatesResult === "requested") {
      trackConfirmedOnce("email", submissionId, () => track("email_doi_requested"));
    }
  };

  const acceptUpdatesConfirmation = (updatesResult, submissionId) => {
    if (updatesStatus) {
      if (updatesResult === "requested") {
        updatesStatus.textContent = "Thanks—your email permission was saved. Check your inbox and confirm your email to finish joining Spartan Updates.";
      } else if (updatesResult === "pending") {
        updatesStatus.textContent = "Your email permission was saved, but we could not send the confirmation email yet. Please try again later.";
      } else if (updatesResult === "blocked") {
        updatesStatus.textContent = "A newer email opt-out is on file, so no confirmation was sent. Submit the form once more if you intentionally want to rejoin.";
      } else {
        updatesStatus.textContent = "A Spartan Updates confirmation was previously requested for this email. Check your inbox or spam folder; if it is missing, contact us and we’ll help.";
      }
    }
    if (updatesResult === "pending") {
      setFormBusy(updatesForm, false, "");
    } else {
      clearPendingSubmission("updates");
    }
    if (updatesResult === "blocked") {
      const submissionField = ensureHiddenField(updatesForm, "submission_id");
      if (submissionField) submissionField.value = "";
      setFormBusy(updatesForm, false, "");
    }
    if (updatesResult === "requested") {
      trackConfirmedOnce("email", submissionId, () => track("email_doi_requested"));
    }
  };

  const discoveryResponseMatches = (result, submissionId) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) return false;
    const expectedKeys = [
      "discovery_contract_version",
      "discovery_result",
      "ok",
      "record_type",
      "submission_id"
    ];
    const actualKeys = Object.keys(result).sort();
    return actualKeys.length === expectedKeys.length
      && expectedKeys.every((key, index) => actualKeys[index] === key)
      && result.ok === true
      && result.record_type === "discovery_source"
      && result.submission_id === submissionId
      && ["saved", "already_saved"].includes(result.discovery_result)
      && result.discovery_contract_version === discoveryContractVersion;
  };

  const requestDiscoverySave = async (submissionId, discoverySource) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), confirmationTimeoutMs);
    try {
      const response = await fetch(discoveryEndpoint, {
        method: "POST",
        credentials: "omit",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          submission_id: submissionId,
          discovery_source: discoverySource
        }),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !discoveryResponseMatches(result, submissionId)) {
        throw new Error("Unconfirmed discovery response");
      }
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  couponDiscoveryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedSource = String(new FormData(couponDiscoveryForm).get("discovery_source") || "");
    const submissionId = activeDiscoverySubmissionId;
    if (!discoverySources.has(selectedSource)) {
      if (couponDiscoveryStatus) couponDiscoveryStatus.textContent = "Choose one answer, or select No thanks.";
      couponDiscoveryForm.querySelector('input[name="discovery_source"]')?.focus();
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/.test(submissionId)) {
      if (couponDiscoveryStatus) couponDiscoveryStatus.textContent = "We couldn’t save this answer. Your coupon is still ready to use.";
      return;
    }

    couponDiscoveryForm.setAttribute("aria-busy", "true");
    couponDiscoveryForm.querySelectorAll("input, button").forEach((control) => {
      control.disabled = true;
    });
    if (couponDiscoveryStatus) couponDiscoveryStatus.textContent = "Saving your answer…";

    try {
      const result = await requestDiscoverySave(submissionId, selectedSource);
      couponDiscoveryForm.removeAttribute("aria-busy");
      couponDiscoveryForm.dataset.complete = "true";
      if (couponDiscoveryStatus) couponDiscoveryStatus.textContent = "Thanks—your answer is saved.";
      activeDiscoverySubmissionId = "";
      if (result.discovery_result === "saved") track("discovery_source_saved");
      couponDiscoveryStatus?.focus({ preventScroll: true });
    } catch (error) {
      couponDiscoveryForm.removeAttribute("aria-busy");
      couponDiscoveryForm.querySelectorAll("input, button").forEach((control) => {
        control.disabled = false;
      });
      if (couponDiscoveryStatus) {
        couponDiscoveryStatus.textContent = "We couldn’t save this answer. Your coupon is still ready to use—you can try again or choose No thanks.";
      }
    }
  });

  couponDiscoverySkip?.addEventListener("click", () => {
    resetDiscoveryPrompt();
    couponResultNextAction?.focus({ preventScroll: true });
  });

  squareOfferConsent?.addEventListener("change", setSquareOfferButtonState);

  const squareOfferResponseMatches = (result) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) return false;
    const expectedKeys = [
      "offer_result",
      "ok",
      "pass_available",
      "pass_url",
      "square_offer_contract_version"
    ];
    const actualKeys = Object.keys(result).sort();
    return actualKeys.length === expectedKeys.length
      && expectedKeys.every((key, index) => actualKeys[index] === key)
      && result.ok === true
      && ["ready", "already_ready", "staff_lookup_required", "already_redeemed"].includes(result.offer_result)
      && typeof result.pass_available === "boolean"
      && result.pass_url === "/api/square/pass"
      && result.square_offer_contract_version === squareOfferContractVersion;
  };

  squareOfferForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!squareOfferConsent?.checked || !squareOfferTurnstileToken) {
      if (squareOfferStatus) squareOfferStatus.textContent = "Check the Square Customer Directory choice and complete the security check first.";
      return;
    }
    if (!activeSquareOfferSubmissionId || !activeSquareOfferCouponCode) {
      if (squareOfferStatus) squareOfferStatus.textContent = "Your coupon is still ready, but this scan code cannot be prepared. Staff can find you by phone.";
      return;
    }

    const button = squareOfferForm.querySelector('button[type="submit"]');
    squareOfferForm.setAttribute("aria-busy", "true");
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing…";
    }
    if (squareOfferStatus) squareOfferStatus.textContent = "Preparing your checkout scan code…";

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), squareOfferTimeoutMs);
    try {
      const response = await fetch(squareOfferEndpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          submission_id: activeSquareOfferSubmissionId,
          coupon_code: activeSquareOfferCouponCode,
          square_profile_consent: "yes",
          turnstile_token: squareOfferTurnstileToken
        }),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !squareOfferResponseMatches(result)) throw new Error("Unconfirmed Square offer response");

      squareOfferForm.removeAttribute("aria-busy");
      squareOfferTurnstileToken = "";
      if (result.pass_available && ["ready", "already_ready"].includes(result.offer_result)) {
        squareOfferForm.setAttribute("hidden", "");
        if (squareOfferStatus) squareOfferStatus.textContent = "Your scan code is ready. Open it and show it to staff before they charge your order.";
        if (squareOfferPass) {
          squareOfferPass.href = result.pass_url;
          squareOfferPass.hidden = false;
        }
        track("square_offer_ready");
        squareOfferStatus?.focus({ preventScroll: true });
      } else if (result.offer_result === "already_redeemed") {
        squareOfferForm.setAttribute("hidden", "");
        if (squareOfferStatus) squareOfferStatus.textContent = "This first-visit offer is already recorded as redeemed. No new scan code was created.";
        squareOfferStatus?.focus({ preventScroll: true });
      } else {
        squareOfferForm.setAttribute("hidden", "");
        if (squareOfferStatus) squareOfferStatus.textContent = "We couldn’t safely verify one eligible Square profile, so no scan code was created. Show your coupon to staff; they can confirm eligibility and find you by phone.";
        track("square_offer_fallback");
        squareOfferStatus?.focus({ preventScroll: true });
      }
    } catch (error) {
      squareOfferForm.removeAttribute("aria-busy");
      squareOfferTurnstileToken = "";
      if (squareOfferTurnstileWidgetId !== null && window.turnstile?.reset) {
        window.turnstile.reset(squareOfferTurnstileWidgetId);
      }
      if (button) button.textContent = "Prepare my scan code";
      if (squareOfferStatus) squareOfferStatus.textContent = "We couldn’t prepare the scan code. Your coupon is still ready; staff can find you by phone.";
      track("square_offer_fallback");
      setSquareOfferButtonState();
    } finally {
      window.clearTimeout(timeout);
    }
  });

  squareOfferPass?.addEventListener("click", () => track("square_offer_pass_opened"));

  const showUnconfirmedState = (form, status, kind) => {
    if (status) {
      status.textContent = kind === "coupon"
        ? "We couldn’t confirm the result yet. Try again, or use secure confirmation below; your claim will not be duplicated."
        : "We couldn’t confirm the result yet. Try again, or use secure confirmation below; your request will not be duplicated.";
    }
    setFormBusy(form, false, "");
    setFallbackAvailable(form, true);
  };

  couponForm?.addEventListener("submit", async (event) => {
    const status = couponForm.querySelector("[data-form-status]");
    event.preventDefault();
    if (isPreviewMode) {
      if (status) status.textContent = "Preview mode: no coupon data was submitted.";
      return;
    }

    const submissionId = prepareSubmission(couponForm, "coupon");
    setFormBusy(couponForm, true, "Saving your claim…");
    setFallbackAvailable(couponForm, false);
    if (status) status.textContent = "Saving your claim and preparing your coupon…";
    track("coupon_submit");

    try {
      const result = await requestConfirmation(couponForm);
      if (!responseMatches(result, submissionId, "coupon_claim")) throw new Error("Mismatched form response");
      if (!["success", "duplicate"].includes(result.coupon_result)) throw new Error("Missing coupon result");
      acceptCouponConfirmation({
        couponStatus: result.coupon_result,
        code: result.coupon_code,
        updatesResult: result.updates_result || "",
        submissionId
      });
    } catch (error) {
      showUnconfirmedState(couponForm, status, "coupon");
    }
  });

  updatesForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isPreviewMode) {
      if (updatesStatus) updatesStatus.textContent = "Preview mode: no email permission was submitted.";
      return;
    }

    const submissionId = prepareSubmission(updatesForm, "updates");
    setFormBusy(updatesForm, true, "Saving your permission…");
    setFallbackAvailable(updatesForm, false);
    if (updatesStatus) updatesStatus.textContent = "Saving your email permission…";
    track("email_signup_submit");

    try {
      const result = await requestConfirmation(updatesForm);
      if (!responseMatches(result, submissionId, "email_signup")) throw new Error("Mismatched form response");
      if (!["requested", "pending", "blocked", "duplicate"].includes(result.updates_result)) throw new Error("Missing updates result");
      acceptUpdatesConfirmation(result.updates_result, submissionId);
    } catch (error) {
      showUnconfirmedState(updatesForm, updatesStatus, "updates");
    }
  });

  document.querySelectorAll("[data-track]").forEach((element) => {
    element.addEventListener("click", () => {
      track(element.dataset.track, {
        destination: element.getAttribute("href") || "button",
        link_location: element.dataset.trackLocation
          || element.closest("section")?.id
          || (element.closest("footer") ? "footer" : "site")
      });
    });
  });

  document.querySelectorAll("[data-mega-kit-group]").forEach((group) => {
    group.addEventListener("toggle", () => {
      if (!group.open) return;
      track("mega_tea_kit_options_expand", {
        option_group: group.dataset.megaKitGroup
      });
    });
  });

  const trackedViews = document.querySelectorAll("[data-track-view]");
  if (trackedViews.length && "IntersectionObserver" in window) {
    const viewObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        track(entry.target.dataset.trackView);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.3 });

    trackedViews.forEach((element) => viewObserver.observe(element));
  }

  const params = new URLSearchParams(window.location.search);
  const directCouponRequested = params.get("claim") === "first-drink";
  const couponStatus = params.get("coupon");
  const updatesResult = params.get("updates");
  const returnedSubmissionId = (params.get("submission_id") || "")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 80);
  const handlerMatches = acceptedNativeHandlerVersions.has(params.get("handler_version"));
  const isFilteredReturn = params.get("filtered") === "success";
  const hasCouponResult = ["success", "duplicate"].includes(couponStatus);
  const hasUpdatesResult = ["requested", "pending", "blocked", "duplicate"].includes(updatesResult);
  const isDoiConfirmation = updatesResult === "confirmed";
  const returnKind = hasCouponResult ? "coupon" : hasUpdatesResult ? "updates" : "";
  const pendingSubmission = returnKind ? readPendingSubmission(returnKind) : null;
  const returnMatches = Boolean(
    !isFilteredReturn
    && handlerMatches
    && returnedSubmissionId
    && pendingSubmission
    && returnedSubmissionId === pendingSubmission.id
  );

  // Remove one-time navigation and form-result details before analytics records
  // the page URL. This keeps the claim trigger, coupon codes and submission
  // identifiers out of analytics destinations while preserving campaign tags.
  if (directCouponRequested || resultParameterNames.some((name) => params.has(name))) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("claim");
    resultParameterNames.forEach((name) => cleanUrl.searchParams.delete(name));
    window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  if (typeof window.fbq === "function") {
    window.fbq("track", "PageView");
  }

  if (typeof window.gtag === "function") {
    window.gtag("event", "page_view", {
      page_title: document.title,
      page_location: analyticsPageLocation()
    });
  }

  if (directCouponRequested && couponDialog && !returnMatches) {
    openCoupon();
  }

  if (isDoiConfirmation && updatesConfirmation) {
    showUpdatesConfirmation();
    track("email_confirmation_return", {
      source: "brevo_doi_return",
      verification: "provider_redirect"
    });
  }

  if (returnMatches && hasCouponResult) {
    const code = (params.get("code") || "FIRST-VISIT").replace(/[^A-Z0-9-]/gi, "").slice(0, 24);
    acceptCouponConfirmation({
      couponStatus,
      code,
      updatesResult,
      submissionId: returnedSubmissionId
    });
  }

  if (returnMatches && hasUpdatesResult && !hasCouponResult) {
    acceptUpdatesConfirmation(updatesResult, returnedSubmissionId);
  }

  const keepPendingUpdatesRetry = returnKind === "updates"
    && returnMatches
    && updatesResult === "pending";
  if (returnKind && (returnMatches || isFilteredReturn) && !keepPendingUpdatesRetry) {
    clearPendingSubmission(returnKind);
  }

  if (year) year.textContent = String(new Date().getFullYear());
})();
