(() => {
  "use strict";

  const navToggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  const couponDialog = document.getElementById("coupon-dialog");
  const couponFormStep = document.querySelector("[data-coupon-form-step]");
  const couponResult = document.querySelector("[data-coupon-result]");
  const couponCode = document.querySelector("[data-coupon-code]");
  const couponForm = document.getElementById("coupon-form");
  const updatesForm = document.getElementById("updates-form");
  const updatesStatus = document.getElementById("updates-status");
  const year = document.getElementById("current-year");
  const productionHosts = ["spartandrink.com", "www.spartandrink.com"];
  const isPreviewMode = !productionHosts.includes(window.location.hostname);
  const expectedHandlerVersion = "spartan-forms-v3.1-2026-08-10";
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

  const track = (eventName, details = {}) => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...details });

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, details);
    }

    if (typeof window.fbq === "function") {
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

  const showCouponResult = (code = "FIRST-VISIT") => {
    couponFormStep?.setAttribute("hidden", "");
    couponResult?.removeAttribute("hidden");
    if (couponCode) couponCode.textContent = code;
  };

  const showCouponForm = () => {
    couponResult?.setAttribute("hidden", "");
    couponFormStep?.removeAttribute("hidden");
  };

  const openCoupon = () => {
    if (!couponDialog) return;

    if (localStorage.getItem("spartanCouponClaimed") === "true") {
      showCouponResult(localStorage.getItem("spartanCouponCode") || "FIRST-VISIT");
    } else {
      showCouponForm();
    }

    if (!couponDialog.open) couponDialog.showModal();
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
      referrer: document.referrer,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
      utm_term: params.get("utm_term") || ""
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
    const submissionId = createSubmissionId();
    const field = ensureHiddenField(form, "submission_id");
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

  couponForm?.addEventListener("submit", (event) => {
    const button = couponForm.querySelector('button[type="submit"]');
    const status = couponForm.querySelector("[data-form-status]");
    if (isPreviewMode) {
      event.preventDefault();
      if (status) status.textContent = "Preview mode: no coupon data was submitted.";
      return;
    }
    prepareSubmission(couponForm, "coupon");
    if (button) {
      button.disabled = true;
      button.textContent = "Saving your claim…";
    }
    if (status) status.textContent = "Please wait while we save your coupon.";
    track("coupon_submit");
  });

  updatesForm?.addEventListener("submit", (event) => {
    const button = updatesForm.querySelector('button[type="submit"]');
    if (isPreviewMode) {
      event.preventDefault();
      if (updatesStatus) updatesStatus.textContent = "Preview mode: no email permission was submitted.";
      return;
    }
    prepareSubmission(updatesForm, "updates");
    if (button) {
      button.disabled = true;
      button.textContent = "Saving your permission…";
    }
    if (updatesStatus) updatesStatus.textContent = "Saving your email permission…";
    track("email_signup_submit");
  });

  document.querySelectorAll("[data-track]").forEach((element) => {
    element.addEventListener("click", () => {
      track(element.dataset.track, {
        destination: element.getAttribute("href") || "button"
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
  const handlerMatches = params.get("handler_version") === expectedHandlerVersion;
  const isFilteredReturn = params.get("filtered") === "success";
  const hasCouponResult = ["success", "duplicate"].includes(couponStatus);
  const hasUpdatesResult = ["requested", "duplicate"].includes(updatesResult);
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
      page_location: `${window.location.origin}${window.location.pathname}${window.location.hash}`
    });
  }

  if (isDoiConfirmation && updatesStatus) {
    updatesStatus.textContent = "Your email is confirmed. You’re now on the Spartan Updates email list.";
    track("email_signup_confirmed", {
      source: "brevo_doi_return",
      verification: "provider_redirect"
    });
  }

  if (returnMatches && hasCouponResult) {
    const code = (params.get("code") || "FIRST-VISIT").replace(/[^A-Z0-9-]/gi, "").slice(0, 24);
    localStorage.setItem("spartanCouponClaimed", "true");
    localStorage.setItem("spartanCouponCode", code);
    showCouponResult(code);
    couponDialog?.showModal();
    document.body.classList.add("dialog-open");

    const couponFormStatus = couponForm?.querySelector("[data-form-status]");
    if (couponStatus === "duplicate" && couponFormStatus) {
      couponFormStatus.textContent = "We found your existing first-visit coupon. No duplicate claim was added.";
    }

    if (couponStatus === "success") {
      trackConfirmedOnce("coupon", returnedSubmissionId, () => {
        if (typeof window.fbq === "function") {
          window.fbq("track", "Lead", { source: "coupon_confirmed" });
        }
        track("coupon_confirmed");
      });
    }
  }

  if (returnMatches && hasUpdatesResult && updatesStatus) {
    updatesStatus.textContent = updatesResult === "requested"
      ? "Thanks—your email permission was saved. Check your inbox and confirm your email to finish joining Spartan Updates."
      : "We already have this email on file. If you are not receiving Spartan Updates, contact us and we’ll help.";

    if (updatesResult === "requested") {
      trackConfirmedOnce("email", returnedSubmissionId, () => {
        track("email_doi_requested");
      });
    }
  }

  if (returnKind && (returnMatches || isFilteredReturn)) {
    clearPendingSubmission(returnKind);
  }

  if (year) year.textContent = String(new Date().getFullYear());
})();
