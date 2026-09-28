(() => {
  "use strict";

  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_SIDE = 2000; // foto's worden in de browser verkleind: sneller uploaden, zelfde leesbaarheid
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const STORAGE_KEY = "hsl_email";

  const $ = (id) => document.getElementById(id);
  const emailForm = $("email-form");
  const emailInput = $("email");
  const emailError = $("email-error");
  const toolSection = $("tool");
  const remainingEl = $("remaining");
  const uploadForm = $("upload-form");
  const fileInput = $("file");
  const dropzone = $("dropzone");
  const preview = $("preview");
  const transcribeBtn = $("transcribe-btn");
  const btnLabel = transcribeBtn.querySelector(".btn-label");
  const statusEl = $("status");
  const toolError = $("tool-error");
  const resultBox = $("result");
  const resultText = $("result-text");
  const courseCta = $("course-cta");

  let email = null;
  let remaining = 0;
  let selectedFile = null;

  // ---------- Kleine hulpfuncties ----------

  const storage = {
    get() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch {} },
    clear() { try { localStorage.removeItem(STORAGE_KEY); } catch {} },
  };

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function setStatus(msg, success = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("success", success);
  }

  async function postJson(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Er ging iets mis. Probeer het opnieuw."), { data });
    return data;
  }

  // Toon het echte aantal gratis transcripties (instelbaar via FREE_LIMIT op de server)
  fetch("/api/config")
    .then((res) => res.json())
    .then(({ limit }) => {
      if (limit) document.querySelectorAll("[data-free-limit]").forEach((el) => (el.textContent = `${limit} gratis ${limit === 1 ? "transcriptie" : "transcripties"}`));
    })
    .catch(() => {});

  // ---------- E-mail en toegang ----------

  function updateRemaining(n) {
    remaining = n;
    if (n > 0) {
      remainingEl.textContent = `Je hebt nog ${n} gratis ${n === 1 ? "transcriptie" : "transcripties"}.`;
    } else {
      remainingEl.textContent = "Je hebt je gratis transcripties gebruikt. Bedankt voor het uitproberen!";
    }
    fileInput.disabled = n <= 0;
    dropzone.style.display = n > 0 ? "" : "none";
    transcribeBtn.hidden = n <= 0;
    if (n <= 0) {
      preview.hidden = true;
      courseCta.hidden = false;
    }
    updateButton();
  }

  function unlockTool(addr, n) {
    email = addr;
    storage.set(addr);
    toolSection.hidden = false;
    updateRemaining(n);
  }

  function scrollToEmailOrTool() {
    if (!toolSection.hidden) {
      toolSection.scrollIntoView({ block: "start" });
    } else {
      emailInput.scrollIntoView({ block: "center" });
      emailInput.focus({ preventScroll: true });
    }
  }

  document.querySelectorAll("[data-scroll-to-email]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      scrollToEmailOrTool();
    })
  );

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = emailInput.value.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) {
      showError(emailError, "Vul een geldig e-mailadres in, bijvoorbeeld naam@school.nl.");
      emailInput.focus();
      return;
    }
    showError(emailError, "");
    const btn = emailForm.querySelector("button");
    btn.disabled = true;
    try {
      const data = await postJson("/api/register", { email: addr });
      unlockTool(addr, data.remaining);
      toolSection.scrollIntoView({ block: "start" });
    } catch (err) {
      showError(emailError, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("switch-email").addEventListener("click", () => {
    storage.clear();
    email = null;
    toolSection.hidden = true;
    emailInput.value = "";
    scrollToEmailOrTool();
  });

  // Bij terugkeer: e-mailadres uit deze browser opnieuw gebruiken
  const saved = storage.get();
  if (saved && EMAIL_RE.test(saved)) {
    emailInput.value = saved;
    postJson("/api/register", { email: saved })
      .then((data) => unlockTool(saved, data.remaining))
      .catch(() => {});
  }

  // ---------- Foto kiezen ----------

  function updateButton() {
    transcribeBtn.disabled = !selectedFile || remaining <= 0 || transcribeBtn.classList.contains("is-loading");
  }

  function pickFile(file) {
    showError(toolError, "");
    setStatus("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showError(toolError, "Dit is geen afbeelding. Kies een foto (JPG, PNG, WEBP of GIF).");
      return;
    }
    if (file.size > MAX_BYTES) {
      showError(toolError, "Deze foto is groter dan 10 MB. Kies een kleinere foto.");
      return;
    }
    selectedFile = file;
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    updateButton();
  }

  fileInput.addEventListener("change", () => pickFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach((type) =>
    dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((type) =>
    dropzone.addEventListener(type, () => dropzone.classList.remove("dragover"))
  );
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    pickFile(e.dataTransfer.files[0]);
  });

  // Verklein grote foto's naar JPEG. Lukt dat niet (bijv. onbekend formaat), dan sturen we het origineel.
  function shrinkImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const small = scale === 1 && file.size < 3 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/.test(file.type);
        if (small) return resolve(file);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.9);
      };
      img.onerror = () => resolve(file);
      img.src = preview.src;
    });
  }

  // ---------- Transcriberen ----------

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedFile || !email) return;

    showError(toolError, "");
    transcribeBtn.classList.add("is-loading");
    btnLabel.textContent = "Bezig met transcriberen…";
    updateButton();
    setStatus("De foto wordt gelezen. Dit duurt meestal 10 tot 40 seconden.");

    try {
      const image = await shrinkImage(selectedFile);
      const form = new FormData();
      form.append("email", email);
      form.append("image", image, "foto.jpg");

      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (typeof data.remaining === "number") updateRemaining(data.remaining);
      if (!res.ok) throw new Error(data.error || "Er ging iets mis bij het transcriberen. Probeer het opnieuw.");

      resultText.value = data.text;
      resultBox.hidden = false;
      courseCta.hidden = false;
      setStatus("Klaar! Controleer de tekst hieronder.", true);
      resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setStatus("");
      const offline = err instanceof TypeError;
      showError(toolError, offline ? "Geen verbinding met de server. Controleer je internet en probeer het opnieuw." : err.message);
    } finally {
      transcribeBtn.classList.remove("is-loading");
      btnLabel.textContent = "Transcribeer";
      updateButton();
    }
  });

  // ---------- Kopiëren en downloaden ----------

  $("copy-btn").addEventListener("click", async (e) => {
    const label = e.currentTarget.querySelector("span");
    try {
      await navigator.clipboard.writeText(resultText.value);
    } catch {
      resultText.select();
      document.execCommand("copy");
    }
    label.textContent = "Gekopieerd!";
    setTimeout(() => (label.textContent = "Kopieer"), 2000);
  });

  $("download-btn").addEventListener("click", () => {
    const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const paragraphs = resultText.value
      .split(/\n\s*\n/)
      .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
      .join("\n");
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>Transcriptie</title>' +
      "<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.5}</style></head>" +
      `<body>${paragraphs}</body></html>`;
    const blob = new Blob(["﻿", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcriptie-${new Date().toISOString().slice(0, 10)}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
