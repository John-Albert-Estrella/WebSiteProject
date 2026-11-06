import { auth, db } from "./firebase-init.js";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  writeBatch,
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let unsubscribeNotifs = null;

/**
 * Initializes real-time listener for current user notifications
 * Uses client-side sorting to eliminate the requirement for Firestore composite indexes.
 */
export function initNotifications(currentUser) {
  if (!currentUser) return;

  const bellBtn = document.getElementById("btn-notif-bell");
  const badge = document.getElementById("notif-badge");
  const dropdown = document.getElementById("notif-dropdown");
  const notifList = document.getElementById("notif-list");
  const btnMarkAll = document.getElementById("btn-mark-all-read");

  if (!bellBtn || !dropdown || !notifList) return;

  // Toggle notification tray visibility
  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("show");
  });

  // Close tray when clicking outside
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
      dropdown.classList.remove("show");
    }
  });

  // Tear down existing listener if previously initialized
  if (unsubscribeNotifs) {
    unsubscribeNotifs();
  }

  // Single-field query: Only filters by recipientUid (No composite index required!)
  const q = query(
    collection(db, "notifications"),
    where("recipientUid", "==", currentUser.uid)
  );

  unsubscribeNotifs = onSnapshot(q, (snapshot) => {
    const notifications = [];
    let unreadCount = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      data.id = docSnap.id;
      if (!data.read) {
        unreadCount++;
      }
      notifications.push(data);
    });

    // In-memory JavaScript sort: Newest first
    notifications.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeB - timeA;
    });

    // Dynamic red badge updater
    if (badge) {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        badge.classList.remove("hidden");
      } else {
        badge.textContent = "0";
        badge.classList.add("hidden");
      }
    }

    renderNotificationList(notifications, notifList);
  }, (err) => {
    console.error("Notifications listener error:", err);
  });

  // Mark all notifications as read
  btnMarkAll?.addEventListener("click", async () => {
    try {
      const qUnread = query(
        collection(db, "notifications"),
        where("recipientUid", "==", currentUser.uid),
        where("read", "==", false)
      );
      const snap = await getDocs(qUnread);
      if (snap.empty) return;

      const batch = writeBatch(db);
      snap.forEach((d) => {
        batch.update(doc(db, "notifications", d.id), { read: true });
      });
      await batch.commit();
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  });
}

/**
 * Builds and renders the notification items inside the dropdown popover
 */
function renderNotificationList(items, container) {
  container.innerHTML = "";

  if (items.length === 0) {
    container.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
    return;
  }

  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = `notif-item ${item.read ? "" : "unread"}`;

    let dateStr = "Just now";
    if (item.createdAt?.toDate) {
      dateStr = item.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (item.createdAt) {
      dateStr = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    el.innerHTML = `
      <div class="notif-item-header">
        <span class="notif-item-category">${item.category || "System"}</span>
        <span class="notif-item-time">${dateStr}</span>
      </div>
      <p class="notif-item-message">${item.message || ""}</p>
    `;

    el.addEventListener("click", async () => {
      if (!item.read) {
        try {
          await updateDoc(doc(db, "notifications", item.id), { read: true });
        } catch (e) {
          console.error("Failed to mark read:", e);
        }
      }
      if (item.link) {
        window.location.href = item.link;
      }
    });

    container.appendChild(el);
  });
}