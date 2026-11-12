// js/theme.js - Synchronous Dark/Light Theme Engine
const STORAGE_KEY = "aimser_theme";

function applyTheme(theme) {
  const normalized = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", normalized);
  document.documentElement.classList.toggle("dark-theme", normalized === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Ignore storage restriction
  }

  const toggleBtn = document.getElementById("theme-toggle-btn");
  if (toggleBtn) {
    const icon = toggleBtn.querySelector("i");
    if (icon) {
      icon.className = normalized === "dark" ? "fas fa-sun" : "fas fa-moon";
    }
  }
}

// Apply immediately on parse to eliminate FOUC
const savedTheme = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) || "dark";
  } catch {
    return "dark";
  }
})();
applyTheme(savedTheme);

document.addEventListener("DOMContentLoaded", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") || "dark");

  const toggleBtn = document.getElementById("theme-toggle-btn");
  if (toggleBtn && !toggleBtn.dataset.themeBound) {
    toggleBtn.dataset.themeBound = "true";
    toggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }
});