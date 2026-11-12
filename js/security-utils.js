// js/security-utils.js - Centralized Security, Zero-Buffer Cache & Audit Telemetry
import { db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const CACHE_PREFIX = "aimser_v2_";

/**
 * Synchronous Session Cache for 0ms UI hydration (Zero-Buffer Rendering)
 */
export const FastCache = {
  set(key, value) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
        ts: Date.now(),
        data: value
      }));
    } catch {
      // Ignore quota errors
    }
  },
  get(key, maxAgeMs = 300000) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > maxAgeMs) {
        sessionStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  },
  clearAll() {
    try {
      Object.keys(sessionStorage).forEach((k) => {
        if (k.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(k);
      });
      localStorage.removeItem("aimser_active_classroom");
    } catch {
      // Ignore
    }
  }
};

/**
 * Strict HTML Entity Escaping to neutralize Stored/Reflected XSS
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validates URLs to prevent javascript: or data: payload execution
 */
export function sanitizeUrl(url, fallback = "") {
  if (!url) return fallback;
  const trimmed = String(url).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return fallback;
}

/**
 * Client-Side Sliding-Window Rate Limiter
 */
const actionBuckets = new Map();

export function checkRateLimit(actionKey, maxAttempts = 5, windowMs = 60000) {
  const now = Date.now();
  const timestamps = (actionBuckets.get(actionKey) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxAttempts) {
    const waitSec = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
    throw new Error(`Too many requests. Please wait ${waitSec}s before trying again.`);
  }
  timestamps.push(now);
  actionBuckets.set(actionKey, timestamps);
}

/**
 * Emits structured telemetry events to Firestore 'audit_logs'
 */
export async function logAuditEvent(message, category = "SYSTEM", actorEmail = "system") {
  try {
    await addDoc(collection(db, "audit_logs"), {
      message: String(message).slice(0, 300),
      category,
      actorEmail,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.warn("[Audit Telemetry] Non-blocking log skipped:", err.message);
  }
}