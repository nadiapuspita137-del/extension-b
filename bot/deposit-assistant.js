(() => {
  if (window.__bnsDepositAssistantLoaded) return;
  window.__bnsDepositAssistantLoaded = true;

  const BANK_VALUE = "SCB|41466";
  const USERNAME_SELECTOR = "#MemberListCredit_txtSearch";
  const AMOUNT_SELECTOR = "#ctl03_txtCreditNum";
  const BANK_SELECTOR = "#ctl03_lstBankTo";
  const REMARK_SELECTOR = "#ctl03_txtRemark";
  const BANNER_ID = "bns-bot-assistant-banner";

  const normalizeUsername = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.message || "Bot tidak merespons.");
    return response;
  }

  async function waitForForm() {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const username = document.querySelector(USERNAME_SELECTOR);
      const amount = document.querySelector(AMOUNT_SELECTOR);
      const bank = document.querySelector(BANK_SELECTOR);
      const remark = document.querySelector(REMARK_SELECTOR);
      if (username && amount && bank && remark) return { username, amount, bank, remark };
      await delay(300);
    }
    throw new Error("Field Deposit Manual belum lengkap setelah 15 detik.");
  }

  function emitValue(element, value) {
    element.focus();
    element.value = String(value);
    element.setAttribute("value", String(value));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function finalSubmitControl(amountField) {
    const submitSpans = [...document.querySelectorAll("span.ENG")]
      .filter((span) => span.textContent.trim().toLocaleLowerCase("en-US") === "submit");
    const controls = submitSpans
      .map((span) => span.closest("button, a, input[type='submit'], input[type='button']") || span.parentElement)
      .filter((control) => control && (amountField.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING));
    return controls.at(-1) || null;
  }

  function banner(title, detail, kind = "ready") {
    let node = document.getElementById(BANNER_ID);
    if (!node) {
      node = document.createElement("aside");
      node.id = BANNER_ID;
      node.style.cssText = [
        "position:fixed", "top:14px", "right:14px", "z-index:2147483647", "width:330px",
        "padding:14px 16px", "border-radius:12px", "font:13px/1.45 Arial,sans-serif",
        "box-shadow:0 12px 34px rgba(0,0,0,.25)", "color:#fff"
      ].join(";");
      document.documentElement.appendChild(node);
    }
    node.style.background = kind === "error" ? "#a92f35" : kind === "waiting" ? "#805b13" : "#137452";
    node.replaceChildren();
    const strong = document.createElement("strong");
    strong.style.cssText = "display:block;font-size:15px;margin-bottom:4px";
    strong.textContent = title;
    const text = document.createElement("div");
    text.textContent = detail;
    node.append(strong, text);
  }

  function highlight(element, color = "#18a36e") {
    element.style.outline = `3px solid ${color}`;
    element.style.outlineOffset = "2px";
  }

  function validate(form, current) {
    if (normalizeUsername(form.username.value) !== current.usernameKey) return "Username pada form berubah/tidak cocok.";
    if (String(form.amount.value).replace(/\D/g, "") !== String(current.bonusAmount)) return "Amount pada form berubah/tidak cocok.";
    if (form.bank.value !== BANK_VALUE) return "To Bank bukan SCB A BONUS DEPOSIT HARIAN 01.";
    if (form.remark.value !== "") return "Remark wajib kosong.";
    return "";
  }

  async function prepare() {
    let response;
    try {
      response = await send({ type: "BNS_BOT_GET_STATE" });
    } catch {
      return;
    }
    const state = response.state;
    if (!response.authorized || !state?.active || !state.current) return;
    if (["SUBMIT_CLICKED", "ADVANCING"].includes(state.stage)) {
      banner("BOT: ANTREAN BERIKUTNYA", `Submit ${state.current.username} sudah dicatat. Menyiapkan ID selanjutnya.`, "waiting");
      return;
    }

    try {
      const form = await waitForForm();
      if (normalizeUsername(form.username.value) !== state.current.usernameKey) {
        throw new Error(`Username form ${form.username.value || "(kosong)"} tidak cocok dengan ${state.current.username}.`);
      }
      const bankOption = [...form.bank.options].find((option) => option.value === BANK_VALUE);
      if (!bankOption) throw new Error("Pilihan To Bank SCB|41466 tidak ditemukan.");

      if (form.bank.value !== BANK_VALUE) {
        banner("BOT: PILIH TO BANK", "Memilih SCB A BONUS DEPOSIT HARIAN 01, lalu menunggu postback panel.", "waiting");
        await send({
          type: "BNS_BOT_FORM_STAGE",
          stage: "BANK_POSTBACK",
          usernameKey: state.current.usernameKey
        });
        form.bank.value = BANK_VALUE;
        form.bank.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }

      emitValue(form.amount, state.current.bonusAmount);
      emitValue(form.remark, "");
      const submit = finalSubmitControl(form.amount);
      if (!submit) throw new Error("Tombol final Submit setelah field Amount tidak ditemukan.");
      const mismatch = validate(form, state.current);
      if (mismatch) throw new Error(mismatch);

      highlight(form.amount);
      highlight(form.bank);
      highlight(form.remark);
      highlight(submit, "#e4981c");
      banner(
        "BOT READY — KLIK SUBMIT",
        `${state.current.username} · Bonus ${Number(state.current.bonusAmount).toLocaleString("id-ID")}. Cek lalu klik Submit yang disorot.`
      );
      await send({
        type: "BNS_BOT_FORM_STAGE",
        stage: "READY_TO_SUBMIT",
        usernameKey: state.current.usernameKey
      });

      submit.addEventListener("click", (event) => {
        const error = validate(form, state.current);
        if (error) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          banner("BOT: SUBMIT DIBLOKIR", error, "error");
          window.alert(`BNS Bot: ${error}`);
          return;
        }
        banner("BOT: MENGIRIM", `Submit admin diterima untuk ${state.current.username}. Berikutnya akan dibuka otomatis.`, "waiting");
        // Jangan preventDefault atau click() ulang. Tombol panel memakai href javascript:
        // dan harus tetap berjalan dari klik asli admin pada page world agar tidak diblokir CSP extension.
        send({ type: "BNS_BOT_FINAL_SUBMIT", usernameKey: state.current.usernameKey }).catch((submitError) => {
          banner("BOT: STATUS GAGAL DICATAT", submitError.message, "error");
        });
      }, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Form gagal disiapkan.";
      banner("BOT BERHENTI DI FORM", message, "error");
      if (state?.current?.usernameKey) {
        send({
          type: "BNS_BOT_FORM_STAGE",
          stage: "FORM_ERROR",
          usernameKey: state.current.usernameKey,
          error: message
        }).catch(() => {});
      }
    }
  }

  prepare();
})();
