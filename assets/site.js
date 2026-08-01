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

  const track = (eventName, details = {}) => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...details });

    if (typeof window.fbq === "function") {
      window.fbq("trackCustom", eventName, details);
    }
  };

  const setNavOpen = (open) => {
    if (!navToggle || !nav) return;
    navToggle.setAttribute("aria-expanded", String(open));
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavOpen(false);
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

  setReturnUrl(couponForm, "coupon");
  setReturnUrl(updatesForm, "updates");

  couponForm?.addEventListener("submit", () => {
    const button = couponForm.querySelector('button[type="submit"]');
    const status = couponForm.querySelector("[data-form-status]");
    if (button) {
      button.disabled = true;
      button.textContent = "Saving your claim…";
    }
    if (status) status.textContent = "Please wait while we save your coupon.";
    track("coupon_submit");
  });

  updatesForm?.addEventListener("submit", () => {
    const button = updatesForm.querySelector('button[type="submit"]');
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

  const params = new URLSearchParams(window.location.search);
  const couponStatus = params.get("coupon");
  const updatesResult = params.get("updates");

  if (couponStatus === "success") {
    const code = (params.get("code") || "FIRST-VISIT").replace(/[^A-Z0-9-]/gi, "").slice(0, 24);
    localStorage.setItem("spartanCouponClaimed", "true");
    localStorage.setItem("spartanCouponCode", code);
    showCouponResult(code);
    couponDialog?.showModal();
    document.body.classList.add("dialog-open");

    if (sessionStorage.getItem("spartanLeadTracked") !== "true") {
      if (typeof window.fbq === "function") {
        window.fbq("track", "Lead", { source: "coupon_confirmed" });
      }
      track("coupon_confirmed");
      sessionStorage.setItem("spartanLeadTracked", "true");
    }
  }

  if (updatesResult === "success" && updatesStatus) {
    updatesStatus.textContent = "You’re on the Spartan Updates email list. Watch your inbox for useful store updates.";
    track("email_signup_confirmed");
  }

  if (couponStatus || updatesResult) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("coupon");
    cleanUrl.searchParams.delete("code");
    cleanUrl.searchParams.delete("updates");
    window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.hash}`);
  }

  if (year) year.textContent = String(new Date().getFullYear());
})();
