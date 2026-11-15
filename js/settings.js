// js/settings.js - Unified Portfolio Outputs, 6 Core Telemetry Metrics, Locked Submissions & Account Security
import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { uploadToCloudinary } from "./cloudinary-config.js";
import { FastCache, escapeHtml, sanitizeUrl, logAuditEvent } from "./security-utils.js";

let currentUser = null;
let currentProfile = null;
let enrolledClassrooms = [];
let activeClassroom = null;
let classroomActivities = [];
let submissionsByActId = new Map();
let portfolioDocData = { artifacts: [] };
let savedAbsenteeismRate = "0%";
let portfolioNotifications = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  currentUser = user;

  const cached = FastCache.get("user_profile");
  if (cached) {
    currentProfile = cached;
    populateSettingsUI(user, cached);
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    currentProfile = {
      uid: user.uid,
      email: user.email,
      fullName: data.fullName || user.displayName || user.email.split("@")[0],
      role: (data.role || "student").toLowerCase(),
      department: data.department || "",
      avatarUrl: data.avatarUrl || user.photoURL || ""
    };
    FastCache.set("user_profile", currentProfile);
    populateSettingsUI(user, currentProfile);
  } catch (err) {
    console.error("Settings load error:", err);
  }

  setupAvatarPreview();
  setupProfileSubmit();
  setupPasswordSubmit();
  setupPasswordVisibilityToggles();
  bindPortfolioEvents();

  await loadPortfolioClassrooms();
});

function populateSettingsUI(user, data) {
  const nameInput = document.getElementById("settings-fullname");
  const emailInput = document.getElementById("settings-email");
  const deptInput = document.getElementById("settings-department");
  const roleBadge = document.getElementById("settings-role-badge");
  const avatarPreview = document.getElementById("settings-avatar-preview");

  const resolvedName = data.fullName || user.displayName || "Member";
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=1b5375&color=faf2dd`;
  const resolvedAvatar = sanitizeUrl(data.avatarUrl || user.photoURL, fallback);

  if (nameInput) nameInput.value = resolvedName;
  if (emailInput) emailInput.value = user.email || "";
  if (deptInput) deptInput.value = data.department || "";
  if (roleBadge) roleBadge.value = (data.role || "student").toUpperCase();
  if (avatarPreview) avatarPreview.src = resolvedAvatar;
}

function isActivityPastDeadline(act) {
  if (!act || !act.dueDate) return false;
  const dueMs = new Date(act.dueDate).getTime();
  return !isNaN(dueMs) && Date.now() > dueMs;
}

async function loadPortfolioClassrooms() {
  const select = document.getElementById("portfolio-classroom-select");
  if (!select) return;

  try {
    const snap = await getDocs(collection(db, "classrooms"));
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const isFaculty = (currentProfile?.role || "student") === "faculty";

    if (isFaculty) {
      enrolledClassrooms = all.filter(
        (c) => c.instructorId === currentUser.uid || c.instructorEmail === currentUser.email
      );
    } else {
      enrolledClassrooms = all.filter((c) => {
        const students = c.students || c.enrolled || [];
        return students.some((s) =>
          typeof s === "string" ? s === currentUser.uid || s === currentUser.email : s.uid === currentUser.uid
        );
      });
    }

    if (enrolledClassrooms.length === 0) {
      select.innerHTML = `<option value="">No Active Classrooms</option>`;
      renderEmptyPortfolio();
      return;
    }

    select.innerHTML = enrolledClassrooms
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name || "Classroom")}</option>`)
      .join("");

    const savedId = localStorage.getItem("aimser_active_classroom");
    const target = enrolledClassrooms.find((c) => c.id === savedId) || enrolledClassrooms[0];
    select.value = target.id;
    await loadClassroomPortfolioTelemetry(target.id);
  } catch (err) {
    console.error("Failed loading portfolio classrooms:", err);
  }
}

async function loadClassroomPortfolioTelemetry(classroomId) {
  activeClassroom = enrolledClassrooms.find((c) => c.id === classroomId) || null;
  if (!activeClassroom) {
    renderEmptyPortfolio();
    return;
  }

  localStorage.setItem("aimser_active_classroom", classroomId);
  portfolioNotifications = [];

  try {
    try {
      const anSnap = await getDoc(doc(db, "classrooms", classroomId, "analytics_reports", currentUser.uid));
      savedAbsenteeismRate = anSnap.exists() ? anSnap.data().absenteeismRate || "0%" : "0%";
    } catch {
      savedAbsenteeismRate = "0%";
    }

    try {
      const portSnap = await getDoc(doc(db, "classrooms", classroomId, "portfolios", currentUser.uid));
      portfolioDocData = portSnap.exists() ? portSnap.data() : { artifacts: [] };
    } catch {
      portfolioDocData = { artifacts: [] };
    }

    const mergedMap = new Map();
    try {
      const subSnap = await getDocs(collection(db, "classrooms", classroomId, "activities"));
      subSnap.docs.forEach((d) => mergedMap.set(d.id, { id: d.id, ...d.data() }));
    } catch {
      // Optional
    }

    try {
      const rootSnap = await getDocs(collection(db, "activities"));
      rootSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.classroomId === classroomId || data.sectionId === classroomId) {
          mergedMap.set(d.id, { id: d.id, ...data });
        }
      });
    } catch {
      // Optional
    }

    classroomActivities = Array.from(mergedMap.values());
    submissionsByActId.clear();

    await Promise.all(
      classroomActivities.map(async (act) => {
        try {
          const subSnap = await getDocs(collection(db, "classrooms", classroomId, "activities", act.id, "submissions"));
          const subs = subSnap.docs.map((s) => ({ id: s.id, ...s.data() }));
          submissionsByActId.set(act.id, subs);
        } catch {
          submissionsByActId.set(act.id, []);
        }
      })
    );

    computeAndRenderPortfolio();
    await renderPortfolioNotificationsBell();
  } catch (err) {
    console.error("Error loading portfolio telemetry:", err);
  }
}

function computeAndRenderPortfolio() {
  const totalActivities = classroomActivities.length;
  let completedCount = 0;
  let missingCount = 0;
  let gradedCount = 0;
  let scorePctSum = 0;

  const unifiedOutputs = [];

  classroomActivities.forEach((act) => {
    const subs = submissionsByActId.get(act.id) || [];
    const mySub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);
    const pastDue = isActivityPastDeadline(act);
    const createdMs = act.createdAt?.toMillis ? act.createdAt.toMillis() : 0;

    if (mySub) {
      completedCount++;
      const isGraded = mySub.score !== undefined && mySub.score !== null;
      if (isGraded) {
        gradedCount++;
        scorePctSum += (Number(mySub.score) / (act.maxScore || 100)) * 100;
        portfolioNotifications.push({
          type: "GRADE",
          title: `Graded: ${act.title}`,
          detail: `Score: ${mySub.score}/${act.maxScore || 100} — "${mySub.feedback || "Reviewed by instructor."}"`
        });
      }

      unifiedOutputs.push({
        kind: "activity",
        actId: act.id,
        title: act.title || "Classroom Activity",
        category: act.category || "Activity",
        status: isGraded ? "graded" : "submitted",
        scoreText: isGraded ? `${mySub.score} / ${act.maxScore || 100}` : "Submitted (Locked)",
        summary: mySub.notes || act.instructions || "",
        feedback: mySub.feedback || "",
        fileName: mySub.fileName || "",
        timestamp: mySub.submittedAt?.toMillis ? mySub.submittedAt.toMillis() : createdMs
      });
    } else {
      if (pastDue) {
        missingCount++;
        portfolioNotifications.push({
          type: "CLOSED",
          title: `Missing & Closed: ${act.title}`,
          detail: `Deadline passed on ${new Date(act.dueDate).toLocaleString()}.`
        });
      }
      unifiedOutputs.push({
        kind: "activity",
        actId: act.id,
        title: act.title || "Classroom Activity",
        category: act.category || "Activity",
        status: pastDue ? "missing" : "pending",
        scoreText: pastDue ? "Closed (Missing)" : "Pending Submission",
        summary: act.instructions || "",
        feedback: "",
        fileName: "",
        timestamp: createdMs
      });
    }
  });

  const completionRate = totalActivities > 0 ? Math.round((completedCount / totalActivities) * 100) : 0;
  const avgScore = gradedCount > 0 ? (scorePctSum / gradedCount).toFixed(1) + "%" : "—";
  const computedAbsenteeism =
    savedAbsenteeismRate && savedAbsenteeismRate !== "0%"
      ? savedAbsenteeismRate
      : totalActivities > 0
      ? ((missingCount / totalActivities) * 100).toFixed(1) + "%"
      : "0%";

  document.getElementById("port-metric-absenteeism").textContent = computedAbsenteeism;
  document.getElementById("port-metric-missing").textContent = String(missingCount);
  document.getElementById("port-metric-completed").textContent = String(completedCount);
  document.getElementById("port-metric-total").textContent = String(totalActivities);
  document.getElementById("port-metric-rate").textContent = `${completionRate}%`;
  document.getElementById("port-metric-avg").textContent = avgScore;

  (portfolioDocData?.artifacts || []).forEach((art) => {
    unifiedOutputs.push({
      kind: "artifact",
      title: art.title || "Portfolio Output",
      category: "Portfolio Output",
      status: "submitted",
      scoreText: "Stored Output",
      summary: art.link || "",
      feedback: "",
      fileName: "",
      timestamp: art.createdAt ? new Date(art.createdAt).getTime() : 0
    });
  });

  renderPortfolioCards(unifiedOutputs);
}

function renderPortfolioCards(items) {
  const container = document.getElementById("student-portfolio-items");
  if (!container) return;

  const searchVal = (document.getElementById("portfolio-search-input")?.value || "").toLowerCase().trim();
  const sortMode = document.getElementById("portfolio-sort-select")?.value || "newest";

  const filtered = items
    .filter((item) => {
      if (sortMode === "graded" && item.status !== "graded") return false;
      if (sortMode === "missing" && item.status !== "missing" && item.status !== "pending") return false;
      if (!searchVal) return true;
      return (
        (item.title || "").toLowerCase().includes(searchVal) ||
        (item.category || "").toLowerCase().includes(searchVal) ||
        (item.summary || "").toLowerCase().includes(searchVal)
      );
    })
    .sort((a, b) =>
      sortMode === "oldest" ? (a.timestamp || 0) - (b.timestamp || 0) : (b.timestamp || 0) - (a.timestamp || 0)
    );

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-folder-open"></i>
        <h3>No Matching Portfolio Outputs</h3>
        <p>Your submitted activities and graded outputs will appear here.</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered
    .map((item) => {
      let pillClass = "";
      if (item.status === "graded") pillClass = "status-pill-active";
      else if (item.status === "missing") pillClass = "status-pill-danger";
      else if (item.status === "pending") pillClass = "status-pill-archived";

      if (item.kind === "activity") {
        return `
          <article class="glass-panel portfolio-output-card" data-port-act-id="${item.actId}">
            <div>
              <div class="panel-toolbar">
                <span class="badge-pill">${escapeHtml(item.category)}</span>
                <span class="badge-pill ${pillClass}">${escapeHtml(item.scoreText)}</span>
              </div>
              <h3>${escapeHtml(item.title)}</h3>
              <p class="text-muted">
                ${escapeHtml(item.summary || "Click to inspect activity and rubric details.")}
              </p>
              ${item.feedback ? `<p class="text-muted"><strong>Feedback:</strong> ${escapeHtml(item.feedback)}</p>` : ""}
            </div>
            <div class="card-footer-bar">
              <span class="text-muted">${item.fileName ? `<i class="fas fa-paperclip"></i> ${escapeHtml(item.fileName)}` : "Click to view graded details"}</span>
              <i class="fas fa-chevron-right"></i>
            </div>
          </article>`;
      }

      return `
        <article class="glass-panel portfolio-output-card">
          <div>
            <div class="panel-toolbar">
              <span class="badge-pill">Portfolio Output</span>
              <span class="badge-pill"><i class="fas fa-lock"></i> Locked</span>
            </div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="text-muted">${escapeHtml(item.summary)}</p>
          </div>
        </article>`;
    })
    .join("");

  container.querySelectorAll("[data-port-act-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const targetAct = classroomActivities.find((a) => a.id === card.getAttribute("data-port-act-id"));
      if (targetAct) openPortfolioActivityModal(targetAct);
    });
  });
}

function openPortfolioActivityModal(act) {
  const maxPts = act.maxScore || 100;
  const pastDue = isActivityPastDeadline(act);
  const subs = submissionsByActId.get(act.id) || [];
  const mySub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);

  document.getElementById("detail-act-id").value = act.id;
  document.getElementById("detail-act-title").textContent = act.title || "Activity Details";
  document.getElementById("detail-act-badge").textContent = act.category || "HR Simulation";
  document.getElementById("detail-act-points").textContent = `${maxPts} pts`;
  document.getElementById("detail-act-due").textContent = act.dueDate
    ? `Deadline: ${new Date(act.dueDate).toLocaleString()} ${pastDue ? "(CLOSED)" : ""}`
    : "Deadline: Open";
  document.getElementById("detail-act-rubric").textContent = act.rubric || "Standard Rubric Evaluation";
  document.getElementById("detail-act-desc").textContent = act.instructions || act.description || "";

  const notesInput = document.getElementById("deliverable-notes");
  const fileGroup = document.getElementById("deliverable-file-group");
  const fileInput = document.getElementById("deliverable-file-input");
  const fileInfo = document.getElementById("deliverable-attached-file-info");
  const saveBtn = document.getElementById("btn-save-deliverable");
  const gradeBox = document.getElementById("student-grade-feedback-box");
  const closedNotice = document.getElementById("activity-closed-notice");
  const closedIcon = document.getElementById("activity-closed-icon");
  const closedText = document.getElementById("activity-closed-text");

  notesInput.value = mySub ? mySub.notes || "" : "";
  if (fileInput) fileInput.value = "";

  if (mySub && mySub.score !== undefined && mySub.score !== null) {
    gradeBox?.classList.remove("is-hidden");
    document.getElementById("student-awarded-score").textContent = `${mySub.score} / ${maxPts}`;
    document.getElementById("student-awarded-feedback").textContent =
      mySub.feedback || "No written comments.";
  } else if (gradeBox) {
    gradeBox.classList.add("is-hidden");
  }

  const hasSubmitted = Boolean(mySub);
  const facultyUnlocked = hasSubmitted && Boolean(mySub.allowEdit) && !pastDue;
  const isLocked = pastDue || (hasSubmitted && !facultyUnlocked);

  if (fileInfo) {
    const safeFileUrl = sanitizeUrl(mySub?.fileUrl, "");
    if (safeFileUrl) {
      fileInfo.classList.remove("is-hidden");
      fileInfo.innerHTML = `
        <div class="attached-file-meta">
          <i class="fas fa-file-alt"></i>
          <span>${escapeHtml(mySub.fileName || "Submitted Document")}</span>
        </div>
        <div class="workspace-action-bar">
          <span class="attached-file-lock-tag">
            <i class="fas ${isLocked ? "fa-lock" : "fa-unlock"}"></i>
            ${isLocked ? "Locked" : "Editable"}
          </span>
          <a href="${safeFileUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary">
            <i class="fas fa-download"></i> View / Download
          </a>
        </div>`;
    } else {
      fileInfo.classList.add("is-hidden");
      fileInfo.innerHTML = "";
    }
  }

  if (closedNotice && closedText) {
    if (pastDue) {
      closedNotice.className = "submission-lock-banner";
      if (closedIcon) closedIcon.className = "fas fa-ban";
      closedText.textContent = hasSubmitted
        ? "Deadline has passed. This activity is closed and your submission is permanently locked."
        : "Deadline has passed. This activity is now closed and no longer accepts submissions.";
    } else if (hasSubmitted && !facultyUnlocked) {
      closedNotice.className = "submission-lock-banner";
      if (closedIcon) closedIcon.className = "fas fa-lock";
      closedText.textContent =
        "Output submitted and locked. You cannot edit or remove your submitted document unless allowed by your instructor.";
    } else if (facultyUnlocked) {
      closedNotice.className = "submission-unlocked-banner";
      if (closedIcon) closedIcon.className = "fas fa-unlock";
      closedText.textContent =
        "Your instructor has unlocked your submission. You may update your answer or upload a replacement document before the deadline.";
    } else {
      closedNotice.classList.add("is-hidden");
    }
  }

  notesInput.disabled = isLocked;
  notesInput.readOnly = isLocked;
  if (fileInput) fileInput.disabled = isLocked;
  if (fileGroup) fileGroup.classList.toggle("is-hidden", isLocked);
  if (saveBtn) {
    saveBtn.disabled = isLocked;
    saveBtn.classList.toggle("is-hidden", isLocked);
    saveBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
  }

  const modal = document.getElementById("modal-activity-detail");
  if (modal) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }
}

async function renderPortfolioNotificationsBell() {
  const badge = document.getElementById("notif-badge");
  const list = document.getElementById("notifications-feed-list");
  if (!list || !currentUser) return;

  let warnings = [];
  try {
    const q = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
    const snap = await getDocs(q);
    warnings = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !n.read && n.type === "MODERATION_WARNING")
      .map((w) => ({
        type: "WARNING",
        title: w.title || "Moderation Warning",
        detail: w.reason || "Please review platform guidelines."
      }));
  } catch {
    warnings = [];
  }

  const merged = [...warnings, ...portfolioNotifications];

  if (badge) {
    if (merged.length > 0) {
      badge.style.display = "inline-block";
      badge.textContent = merged.length;
    } else {
      badge.style.display = "none";
    }
  }

  if (merged.length === 0) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>All Caught Up</h3><p>No pending alerts or grade updates.</p></div>`;
    return;
  }

  list.innerHTML = merged
    .map(
      (n) => `
      <div class="inspector-meta-item">
        <div class="panel-toolbar">
          <strong>${escapeHtml(n.title)}</strong>
          <span class="badge-pill">${escapeHtml(n.type)}</span>
        </div>
        <p class="text-muted">${escapeHtml(n.detail)}</p>
      </div>`
    )
    .join("");
}

function renderEmptyPortfolio() {
  const container = document.getElementById("student-portfolio-items");
  if (container) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-briefcase"></i>
        <h3>No Enrolled Classroom</h3>
        <p>Join a classroom in the Office workspace to track your portfolio metrics and graded outputs.</p>
      </div>`;
  }
}

function bindPortfolioEvents() {
  document.getElementById("portfolio-classroom-select")?.addEventListener("change", (e) => {
    if (e.target.value) loadClassroomPortfolioTelemetry(e.target.value);
  });

  document.getElementById("portfolio-search-input")?.addEventListener("input", () => {
    computeAndRenderPortfolio();
  });

  document.getElementById("portfolio-sort-select")?.addEventListener("change", () => {
    computeAndRenderPortfolio();
  });

  document.getElementById("form-submit-deliverable")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeClassroom) return;

    const btn = document.getElementById("btn-save-deliverable");
    const actId = document.getElementById("detail-act-id").value;
    const notes = document.getElementById("deliverable-notes").value.trim();
    const fileInput = document.getElementById("deliverable-file-input");
    const selectedFile = fileInput?.files?.[0] || null;

    const act = classroomActivities.find((a) => a.id === actId);
    if (isActivityPastDeadline(act)) {
      alert("This activity has automatically closed because the deadline has passed.");
      openPortfolioActivityModal(act);
      return;
    }

    const subs = submissionsByActId.get(actId) || [];
    const existingSub = subs.find((s) => s.studentUid === currentUser.uid || s.id === currentUser.uid);
    if (existingSub && !existingSub.allowEdit) {
      alert("Your submission is locked. You cannot edit or remove your submitted output unless your instructor allows it.");
      openPortfolioActivityModal(act);
      return;
    }

    if (!notes && !selectedFile && !existingSub?.fileUrl) {
      alert("Please enter your output/link or attach a document (PDF, DOC, DOCX, etc.) before submitting.");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = selectedFile
      ? '<i class="fas fa-spinner fa-spin"></i> Uploading Document...'
      : '<i class="fas fa-spinner fa-spin"></i> Submitting...';

    try {
      let fileUrl = existingSub?.fileUrl || "";
      let fileName = existingSub?.fileName || "";

      if (selectedFile) {
        fileUrl = await uploadToCloudinary(selectedFile, "aimser/submissions");
        fileName = selectedFile.name;
      }

      await setDoc(
        doc(db, "classrooms", activeClassroom.id, "activities", actId, "submissions", currentUser.uid),
        {
          studentUid: currentUser.uid,
          studentName: currentProfile.fullName,
          studentEmail: currentUser.email,
          notes,
          fileUrl,
          fileName,
          allowEdit: false,
          submittedAt: serverTimestamp()
        },
        { merge: true }
      );

      await loadClassroomPortfolioTelemetry(activeClassroom.id);
      const refreshedAct = classroomActivities.find((a) => a.id === actId);
      if (refreshedAct) {
        openPortfolioActivityModal(refreshedAct);
      } else {
        document.getElementById("modal-activity-detail")?.classList.remove("is-open");
      }
    } catch (err) {
      alert("Submission failed: " + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
    }
  });
}

function setupAvatarPreview() {
  const fileInput = document.getElementById("settings-avatar-input");
  const previewImg = document.getElementById("settings-avatar-preview");
  if (!fileInput || !previewImg || fileInput.dataset.bound) return;
  fileInput.dataset.bound = "true";

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image file (PNG, JPG, or WebP).");
      fileInput.value = "";
      return;
    }
    previewImg.src = URL.createObjectURL(file);
  });
}

function setupProfileSubmit() {
  const form = document.getElementById("settings-profile-form");
  const submitBtn = document.getElementById("btn-save-settings-profile");
  const statusEl = document.getElementById("settings-profile-status");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = document.getElementById("settings-fullname").value.trim();
    const department = document.getElementById("settings-department").value.trim();
    const fileInput = document.getElementById("settings-avatar-input");

    if (!fullName) {
      showStatus(statusEl, "Full name cannot be empty.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    showStatus(statusEl, "", "clear");

    try {
      let finalAvatarUrl = null;
      if (fileInput && fileInput.files.length > 0) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading Photo...';
        const uploaded = await uploadToCloudinary(fileInput.files[0], "aimser/avatars");
        finalAvatarUrl = `${uploaded}?t=${Date.now()}`;
      }

      const payload = {
        fullName,
        department,
        updatedAt: serverTimestamp()
      };
      if (finalAvatarUrl) payload.avatarUrl = finalAvatarUrl;

      await Promise.all([
        updateDoc(doc(db, "users", currentUser.uid), payload),
        updateProfile(currentUser, {
          displayName: fullName,
          ...(finalAvatarUrl ? { photoURL: finalAvatarUrl } : {})
        })
      ]);

      const updatedProfile = {
        ...(currentProfile || {}),
        uid: currentUser.uid,
        email: currentUser.email,
        fullName,
        department,
        ...(finalAvatarUrl ? { avatarUrl: finalAvatarUrl } : {})
      };
      currentProfile = updatedProfile;
      FastCache.set("user_profile", updatedProfile);
      window.dispatchEvent(new CustomEvent("aimser:profile-ready", { detail: updatedProfile }));

      if (finalAvatarUrl) {
        document.getElementById("settings-avatar-preview").src = finalAvatarUrl;
      }
      if (fileInput) fileInput.value = "";

      await logAuditEvent(`User updated profile identity (${fullName})`, "PROFILE", currentUser.email);
      showStatus(statusEl, "Profile changes saved successfully!", "success");
    } catch (err) {
      showStatus(statusEl, err.message || "Failed to save profile.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Profile Changes';
    }
  });
}

function setupPasswordSubmit() {
  const form = document.getElementById("settings-password-form");
  const submitBtn = document.getElementById("btn-save-settings-pw");
  const statusEl = document.getElementById("settings-password-status");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPw = document.getElementById("settings-current-pw").value;
    const newPw = document.getElementById("settings-new-pw").value;
    const confirmPw = document.getElementById("settings-confirm-pw").value;

    if (newPw !== confirmPw) {
      showStatus(statusEl, "New passwords do not match.", "error");
      return;
    }

    if (newPw.length < 6) {
      showStatus(statusEl, "Password must be at least 6 characters.", "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    showStatus(statusEl, "", "clear");

    try {
      const cred = EmailAuthProvider.credential(currentUser.email, currentPw);
      await reauthenticateWithCredential(currentUser, cred);
      await updatePassword(currentUser, newPw);
      await logAuditEvent("User rotated account password", "SECURITY", currentUser.email);
      showStatus(statusEl, "Password updated successfully!", "success");
      form.reset();
    } catch (err) {
      const msg =
        err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
          ? "Current password is incorrect."
          : err.message || "Failed to update password.";
      showStatus(statusEl, msg, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-lock"></i> Update Password';
    }
  });
}

function setupPasswordVisibilityToggles() {
  document.querySelectorAll(".btn-toggle-pw").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.getAttribute("data-target"));
      const icon = btn.querySelector("i");
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      if (icon) {
        icon.className = isPassword ? "far fa-eye-slash" : "far fa-eye";
      }
    });
  });
}

function showStatus(el, msg, type) {
  if (!el) return;
  if (type === "clear" || !msg) {
    el.style.display = "none";
    el.textContent = "";
    el.className = "status-msg";
    return;
  }
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.style.display = "block";
}