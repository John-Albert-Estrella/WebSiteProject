// js/theme.js - Global Theme Controller (Light/Dark Engine)

const THEME_KEY = "aimser_theme";

// 1. Immediately apply theme on initial load to avoid flash of unstyled content
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
})();

// 2. Core theme applier: updates attributes, classes, and UI icons
export function applyTheme(theme) {
  const isDark = theme === "dark";
  const root = document.documentElement;
  const body = document.body;

  // Set standard HTML attributes
  root.setAttribute("data-theme", isDark ? "dark" : "light");

  // Sync class names for CSS compatibility
  if (isDark) {
    root.classList.add("dark-theme");
    root.classList.remove("light-theme");
    if (body) {
      body.classList.add("dark-theme");
      body.classList.remove("light-theme");
    }
  } else {
    root.classList.add("light-theme");
    root.classList.remove("dark-theme");
    if (body) {
      body.classList.add("light-theme");
      body.classList.remove("dark-theme");
    }
  }

  // Persist choice in browser storage
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");

  // Synchronize all toggle button icons and accessible labels across the DOM
  updateToggleButtons(isDark);
}

// 3. Global toggle function
export function toggleTheme() {
  const current = localStorage.getItem(THEME_KEY) || "dark";
  const target = current === "dark" ? "light" : "dark";
  applyTheme(target);
}

// 4. Update button states, icons, and text
function updateToggleButtons(isDark) {
  const buttons = document.querySelectorAll("#theme-toggle-btn, .theme-toggle, [data-action='toggle-theme']");
  
  buttons.forEach((btn) => {
    const icon = btn.querySelector("i");
    if (icon) {
      // FontAwesome sun for light mode switch, moon for dark mode switch
      icon.className = isDark ? "fas fa-sun" : "fas fa-moon";
    }
    btn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  });
}

// 5. Robust Event Delegation: Catches clicks regardless of when elements are created or loaded
function bindThemeListeners() {
  // Direct click listener using event delegation on document
  document.addEventListener("click", (e) => {
    const toggleTarget = e.target.closest("#theme-toggle-btn, .theme-toggle, [data-action='toggle-theme']");
    if (toggleTarget) {
      e.preventDefault();
      toggleTheme();
    }
  });

  // Ensure current icons match state once DOM body is available
  const current = localStorage.getItem(THEME_KEY) || "dark";
  updateToggleButtons(current === "dark");
}

// Attach listener immediately if document is ready, otherwise wait for interactive state
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindThemeListeners);
} else {
  bindThemeListeners();
}