const $ = (sel, root = document) => root.querySelector(sel);

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
    ...opts,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

function readEmailFromForm() {
  const input = document.getElementById("email");
  let v = String(input?.value ?? "").trim();
  if (v) return v;
  const form = document.getElementById("login-form");
  if (form) {
    try {
      v = String(new FormData(form).get("email") ?? "").trim();
    } catch (_) {}
  }
  return v;
}

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (me.email) {
      window.location.replace("/files");
      return;
    }
  } catch (_) {}

  const codeEl = $("#code");
  const sendHint = $("#send-hint");
  const errEl = $("#login-err");
  const btnSend = $("#btn-send");
  const btnLogin = $("#btn-login");

  function clearErr() {
    errEl.textContent = "";
  }

  btnSend.addEventListener("click", async () => {
    clearErr();
    sendHint.textContent = "";
    const email = readEmailFromForm();
    if (!email) {
      errEl.textContent = "请填写邮箱";
      return;
    }
    btnSend.disabled = true;
    try {
      const data = await api("/api/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      sendHint.textContent = data.message || "已发送";
      if (data.debug_code) {
        sendHint.textContent += `（调试码：${data.debug_code}）`;
      }
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      btnSend.disabled = false;
    }
  });

  btnLogin.addEventListener("click", async () => {
    clearErr();
    const email = readEmailFromForm();
    const code = String(codeEl.value || "").trim();
    if (!email || !code) {
      errEl.textContent = "请填写邮箱与验证码";
      return;
    }
    btnLogin.disabled = true;
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      window.location.replace("/files");
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      btnLogin.disabled = false;
    }
  });

  function bindGuestLogin(guestBtn) {
    if (!guestBtn) return;
    guestBtn.addEventListener("click", async () => {
      clearErr();
      const emailInput = document.getElementById("email");
      if (emailInput) emailInput.value = "guest";
      guestBtn.disabled = true;
      try {
        await api("/api/auth/guest-login", { method: "POST", body: "{}" });
        window.location.replace("/files");
      } catch (e) {
        errEl.textContent = e.message;
      } finally {
        guestBtn.disabled = false;
      }
    });
  }

  bindGuestLogin(document.getElementById("btn-guest"));
}

boot();
