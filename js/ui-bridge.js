/* ==========================================================================
   AIMSER Shared UI Bridge (v=18) — External Controller for Tabs, Modals & Notifs
   ========================================================================== */

import { FastCache } from "./security-utils.js?v=18";

const SEEN_NOTIFS_STORAGE_KEY = "aimser_v2_seen_notifs_sig";

document.addEventListener("DOMContentLoaded", () => {
  // 1. Sub-Navigation Tab Switching
  const subnavTabs = document.querySelectorAll(".subnav-tab[data-tab]");
  subnavTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.getAttribute("data-tab");
      const targetPanel = document.getElementById(targetId);
      if (!targetPanel) return;

      document.querySelectorAll(".subnav-tab").forEach((t) => t.classList.remove("active", "is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active", "is-active"));

      tab.classList.add("active", "is-active");
      targetPanel.classList.add("active", "is-active");
    });
  });

  // 2. Modal Close Handlers ([data-close-modal] & Backdrop Click)
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modalId = btn.getAttribute("data-close-modal");
      document.getElementById(modalId)?.classList.remove("is-open");
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove("is-open");
      }
    });
  });

  // 3. Hide Room Code KPI Card on Student View
  const hideRoomCodeForStudents = () => {
    const roomCodeCard = document.getElementById("card-room-code");
    if (!roomCodeCard) return;

    const profile = FastCache.get("user_profile");
    const roleText = (profile?.role || document.getElementById("header-user-role")?.textContent || "").toLowerCase();
    if (roleText.includes("student") || roleText.includes("member")) {
      roomCodeCard.style.display = "none";
    } else if (roleText.includes("faculty") || roleText.includes("instructor") || roleText.includes("admin")) {
      roomCodeCard.style.display = "";
    }
  };
  hideRoomCodeForStudents();
  setTimeout(hideRoomCodeForStudents, 600);
  setTimeout(hideRoomCodeForStudents, 1500);

  // 4. Top-Right Notification Dropdown, Badge Auto-Dismiss & In-Page Detail View
  const bellBtn = document.getElementById("btn-open-notifications");
  const notifBadge = document.getElementById("notif-badge");
  const dropdownMenu = document.getElementById("notif-dropdown-menu");
  const dropdownWrapper = document.getElementById("notif-dropdown-wrapper");
  const feedList = document.getElementById("notifications-feed-list");
  const notifViewPanel = document.getElementById("panel-notification-view");
  const fullPageList = document.getElementById("notif-fullpage-all-list");
  const warningsBox = document.getElementById("user-warnings-container");

  const defaultTabPanel = document.querySelector(".tab-panel.active")?.id || "panel-activities";
  let previousActiveTabId = defaultTabPanel;

  // Build a signature of the current notification list so we know if new alerts arrived
  const getCurrentFeedSignature = () => {
    if (!feedList) return "";
    if (feedList.querySelector(".empty-state")) return "";
    return (feedList.innerText || "").replace(/\s+/g, " ").trim();
  };

  // Hide the red badge and record that the current notifications have been viewed
  const markNotificationsAsSeen = () => {
    if (notifBadge) {
      notifBadge.style.display = "none";
      notifBadge.textContent = "0";
    }
    const sig = getCurrentFeedSignature();
    if (sig) {
      try {
        sessionStorage.setItem(SEEN_NOTIFS_STORAGE_KEY, sig);
      } catch {
        // Ignore storage restrictions
      }
    }
  };

  // Sync badge visibility whenever a page script populates #notifications-feed-list
  const syncBadgeWithSeenState = () => {
    if (!notifBadge || !feedList) return;
    const sig = getCurrentFeedSignature();
    if (!sig) {
      notifBadge.style.display = "none";
      return;
    }
    try {
      const seenSig = sessionStorage.getItem(SEEN_NOTIFS_STORAGE_KEY);
      if (seenSig && seenSig === sig) {
        notifBadge.style.display = "none";
      }
    } catch {
      // Ignore storage restrictions
    }
  };

  if (feedList) {
    const observer = new MutationObserver(() => {
      syncBadgeWithSeenState();
    });
    observer.observe(feedList, { childList: true, subtree: true });
  }

  const openInPageNotificationDetail = (itemEl) => {
    markNotificationsAsSeen();

    const currentActive = document.querySelector(".tab-panel.active:not(#panel-notification-view)");
    if (currentActive && currentActive.id) {
      previousActiveTabId = currentActive.id;
    }

    const titleEl = document.getElementById("notif-detail-title");
    const metaEl = document.getElementById("notif-detail-meta");
    const bodyEl = document.getElementById("notif-detail-body");

    const titleText =
      itemEl?.querySelector("strong, h4, h3")?.textContent?.trim() || "Workspace Notification";
    const timeText =
      itemEl?.querySelector("small, .text-muted, span")?.textContent?.trim() || "Recent Alert";
    const rawBody = itemEl
      ? itemEl.innerText.replace(titleText, "").trim()
      : warningsBox?.innerText?.trim() || "View your latest classroom and workspace notifications below.";

    if (titleEl) titleEl.textContent = titleText;
    if (metaEl) metaEl.textContent = timeText;
    if (bodyEl) bodyEl.textContent = rawBody || titleText;

    if (fullPageList && feedList) {
      fullPageList.innerHTML = feedList.innerHTML;
    }

    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active", "is-active"));
    document.querySelectorAll(".subnav-tab").forEach((t) => t.classList.remove("active", "is-active"));
    notifViewPanel?.classList.add("active", "is-active");
    dropdownMenu?.classList.remove("is-open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Capture phase listener toggles dropdown and immediately clears the red dot
  bellBtn?.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      const willOpen = !dropdownMenu?.classList.contains("is-open");
      dropdownMenu?.classList.toggle("is-open", willOpen);
      bellBtn.setAttribute("aria-expanded", String(willOpen));
      markNotificationsAsSeen();
    },
    true
  );

  feedList?.addEventListener("click", (e) => {
    const clickedItem = e.target.closest("#notifications-feed-list > *");
    if (!clickedItem || clickedItem.classList.contains("empty-state")) return;
    openInPageNotificationDetail(clickedItem);
  });

  fullPageList?.addEventListener("click", (e) => {
    const clickedItem = e.target.closest("#notif-fullpage-all-list > *");
    if (!clickedItem || clickedItem.classList.contains("empty-state")) return;
    openInPageNotificationDetail(clickedItem);
  });

  document.getElementById("btn-view-all-notifs")?.addEventListener("click", () => {
    const firstItem = feedList?.querySelector(":scope > *:not(.empty-state)");
    openInPageNotificationDetail(firstItem);
  });

  document.getElementById("btn-back-from-notif")?.addEventListener("click", () => {
    notifViewPanel?.classList.remove("active", "is-active");
    const targetPanel = document.getElementById(previousActiveTabId) || document.getElementById(defaultTabPanel);
    targetPanel?.classList.add("active", "is-active");
    if (targetPanel?.id) {
      document.querySelector(`.subnav-tab[data-tab="${targetPanel.id}"]`)?.classList.add("active", "is-active");
    }
  });

  document.addEventListener("click", (e) => {
    if (dropdownWrapper && !dropdownWrapper.contains(e.target)) {
      dropdownMenu?.classList.remove("is-open");
      bellBtn?.setAttribute("aria-expanded", "false");
    }
  });
});