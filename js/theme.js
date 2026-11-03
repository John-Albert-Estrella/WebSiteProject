// js/theme.js
export function initTheme() {
  const savedTheme = localStorage.getItem("aimser-theme") || "dark";
  applyTheme(savedTheme);

  // Bind to any theme toggle buttons on the page
  document.querySelectorAll("[data-theme-set]").forEach(button => {
    button.addEventListener("click", () => {
      const targetTheme = button.getAttribute("data-theme-set");
      applyTheme(targetTheme);
    });
  });
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("aimser-theme", theme);

  // Update UI pill active states
  document.querySelectorAll("[data-theme-set]").forEach(btn => {
    if (btn.getAttribute("data-theme-set") === theme) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// Auto-run on load
document.addEventListener("DOMContentLoaded", initTheme);