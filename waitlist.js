(function () {
  var form = document.querySelector("[data-waitlist]");
  if (!form) return;

  var locale = form.getAttribute("data-locale") === "ro" ? "ro" : "en";
  var submit = form.querySelector("[type=submit]");
  var banner = document.querySelector("[data-banner]");
  var label = submit.textContent;
  var endpoint = "https://gvbykuwbxspjzuprzjgf.supabase.co/functions/v1/join-waitlist";

  var copy = {
    ro: {
      sending: "Se trimite…",
      created: "Ești numărul {n} pe listă. Te anunțăm în română când aplicația este disponibilă.",
      updated: "Ești deja pe listă, pe locul {n}. Am actualizat limba anunțului pe română.",
      exists: "Ești deja pe listă, pe locul {n}. Anunțul pleacă în română.",
      accepted: "Te-am notat. Te anunțăm în română când aplicația este disponibilă.",
      invalid_email: "Introdu o adresă de email validă.",
      invalid_name: "Prenumele poate avea cel mult 80 de caractere.",
      consent_required: "Bifează acordul ca să te putem anunța.",
      rate_limited: "Prea multe încercări de pe rețeaua asta. Revino peste o oră.",
      server: "Nu am putut salva înscrierea. Încearcă din nou în câteva minute.",
    },
    en: {
      sending: "Sending…",
      created: "You are number {n} on the list. We'll email you in English when the app is available.",
      updated: "You're already on the list, at number {n}. We updated the announcement language to English.",
      exists: "You're already on the list, at number {n}. The announcement will be in English.",
      accepted: "You're on the list. We'll email you in English when the app is available.",
      invalid_email: "Enter a valid email address.",
      invalid_name: "First name can be at most 80 characters.",
      consent_required: "Tick the consent box so we can notify you.",
      rate_limited: "Too many attempts from this network. Try again in an hour.",
      server: "We couldn't save your signup. Try again in a few minutes.",
    },
  };

  document.querySelectorAll("[data-lang-switch]").forEach(function (link) {
    var url = new URL(link.getAttribute("href"), location.href);
    link.href = url.pathname + location.search + url.hash;
  });

  var params = new URLSearchParams(location.search);
  var source = (params.get("from") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  var sourceInput = form.querySelector("[name=source]");
  if (sourceInput && source) sourceInput.value = source;

  function show(message, ok) {
    banner.hidden = false;
    banner.className = ok ? "sent-banner" : "error-banner";
    banner.textContent = message;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = new FormData(form);
    var email = String(data.get("email") || "").trim();
    var firstName = String(data.get("first_name") || "").trim();
    var consent = form.querySelector("[name=consent]").checked;
    if (!consent) {
      show(copy[locale].consent_required, false);
      return;
    }

    submit.disabled = true;
    submit.textContent = copy[locale].sending;

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        first_name: firstName,
        locale: locale,
        consent: true,
        source: sourceInput ? sourceInput.value : "",
        website: String(data.get("website") || ""),
      }),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, status: response.status, body: body || {} };
        });
      })
      .then(function (result) {
        var body = result.body;
        var text = copy[locale][body.error] || copy[locale][body.status];
        if (body.position && text) text = text.replace("{n}", String(body.position));
        if (!text) text = copy[locale].server;
        show(text, result.ok && !body.error);
        if (result.ok && !body.error) form.reset();
      })
      .catch(function () {
        show(copy[locale].server, false);
      })
      .then(function () {
        submit.disabled = false;
        submit.classList.remove("is-waiting");
        submit.textContent = label;
      });
  });
})();
