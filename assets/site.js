(() => {
  "use strict";

  const navToggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  const couponDialog = document.getElementById("coupon-dialog");
  const couponFormStep = document.querySelector("[data-coupon-form-step]");
  const couponResult = document.querySelector("[data-coupon-result]");
  const couponCode = document.querySelector("[data-coupon-code]");
  const couponResultMessage = document.querySelector("[data-coupon-result-message]");
  const couponForm = document.getElementById("coupon-form");
  const updatesForm = document.getElementById("updates-form");
  const updatesStatus = document.getElementById("updates-status");
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
  const confirmationTimeoutMs = 30000;
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
    "home_products_view",
    "home_delivery_click",
    "member_savings_click",
    "home_shipping_page_click",
    "product_interest_click"
  ]);

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

  const showCouponResult = (code = "FIRST-VISIT", message = "") => {
    couponFormStep?.setAttribute("hidden", "");
    couponResult?.removeAttribute("hidden");
    if (couponCode) couponCode.textContent = code;
    if (couponResultMessage) {
      couponResultMessage.textContent = message;
      couponResultMessage.hidden = !message;
    }
  };

  const showCouponForm = () => {
    couponResult?.setAttribute("hidden", "");
    couponFormStep?.removeAttribute("hidden");
  };

  const focusCouponResult = () => {
    couponResult?.querySelector("[data-coupon-result-title]")?.focus({ preventScroll: true });
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
      showCouponResult(rememberedCode);
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
    if (couponStatus === "duplicate") {
      messages.push("We found your existing first-visit offer, so no duplicate claim was added.");
    }
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
    showCouponResult(safeCode, couponConfirmationMessage(couponStatus, updatesResult));
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

  // Remove form-result details before analytics records the page URL. This keeps
  // coupon codes and submission identifiers out of analytics destinations.
  if (resultParameterNames.some((name) => params.has(name))) {
    const cleanUrl = new URL(window.location.href);
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

  if (isDoiConfirmation && updatesStatus) {
    updatesStatus.textContent = "Thanks—your confirmation link was opened. If confirmation completed successfully, you’re all set for Spartan Updates.";
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
