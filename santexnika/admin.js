"use strict";

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const loginCard = $("#loginCard");
  const dashboard = $("#dashboard");
  const list = $("#adminNewsList");
  const toast = $("#adminToast");
  const tokenKey = "site-admin-token";
  let token = sessionStorage.getItem(tokenKey) || "";
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function prettyDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  async function api(url, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && typeof options.body !== "string") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.message || `Ошибка ${response.status}`), { status: response.status });
    return result;
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function showLogin(message = "") {
    dashboard.hidden = true;
    loginCard.hidden = false;
    const error = $("#loginError");
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  }

  async function loadDashboard() {
    try {
      const [items, health] = await Promise.all([api("/api/admin/news"), api("/api/health")]);
      loginCard.hidden = true;
      dashboard.hidden = false;
      renderNews(items);
      renderSyncState(health.vk || {});
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem(tokenKey);
        token = "";
        showLogin("Сессия завершилась. Войдите ещё раз.");
      } else {
        showLogin(error.message || "Не удалось открыть панель управления.");
      }
    }
  }

  function renderSyncState(vk) {
    const box = $("#syncStatus");
    if (!box) return;
    box.classList.toggle("is-ok", vk.status === "ok");
    box.classList.toggle("is-error", vk.status === "error" || vk.status === "not_configured");
    const text = vk.lastSync
      ? `${vk.status === "ok" ? "Синхронизация завершена" : "Последняя попытка синхронизации"}: ${prettyDate(vk.lastSync)} · ${vk.message || ""}`
      : vk.message || (vk.connected ? "VK готова к синхронизации." : "Импорт VK не настроен — добавьте токен в .env.");
    box.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(text)}</span>`;
  }

  function renderNews(items) {
    const count = $("#newsCount");
    if (count) count.textContent = String(items.length);
    if (!items.length) {
      list.innerHTML = '<div class="empty-list">Публикаций пока нет. Нажмите «Синхронизировать VK» или добавьте новость вручную.</div>';
      return;
    }
    list.innerHTML = items.map((item) => `
      <article class="admin-news-card${item.visible === false ? " is-hidden" : ""}" data-id="${escapeHtml(item.id)}">
        <div class="news-card-head"><div class="news-origin"><b>${item.source === "vk" ? "ВКонтакте" : "На сайте"}</b><span>${escapeHtml(item.category || "Новости")}</span></div><time>${escapeHtml(prettyDate(item.date))}</time></div>
        <div class="news-edit-grid">
          <label class="wide">Заголовок<input type="text" maxlength="120" data-edit-title value="${escapeHtml(item.title || "")}"></label>
          <label class="wide">Текст публикации<textarea maxlength="1800" data-edit-text>${escapeHtml(item.text || "")}</textarea></label>
        </div>
        <div class="news-card-footer">
          <div class="news-card-tools">
            <label><input type="checkbox" data-visible ${item.visible === false ? "" : "checked"}> Показывать на сайте</label>
            <label><input type="checkbox" data-pinned ${item.pinned ? "checked" : ""}> Закрепить</label>
          </div>
          <div class="news-card-actions"><button class="small-button" type="button" data-save>Сохранить</button><button class="small-button delete" type="button" data-delete>Удалить</button></div>
        </div>
      </article>`).join("");
  }

  async function login(event) {
    event.preventDefault();
    const password = $("#adminPassword").value;
    const error = $("#loginError");
    const button = $("#loginForm button[type=submit]");
    button.disabled = true;
    if (error) error.hidden = true;
    try {
      const result = await api("/api/admin/login", { method: "POST", body: { password } });
      token = result.token;
      sessionStorage.setItem(tokenKey, token);
      $("#adminPassword").value = "";
      await loadDashboard();
    } catch (err) {
      if (error) { error.textContent = err.message; error.hidden = false; }
    } finally {
      button.disabled = false;
    }
  }

  async function syncVk() {
    const button = $("#syncButton");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Проверяем стену…";
    try {
      const result = await api("/api/admin/sync", { method: "POST", body: {} });
      await loadDashboard();
      showToast(result.message || "Лента ВКонтакте обновлена.");
    } catch (error) {
      try {
        const health = await api("/api/health");
        renderSyncState(health.vk || {});
      } catch {}
      showToast(error.message || "Не удалось синхронизировать группу.");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function saveCard(card) {
    const id = card.dataset.id;
    const button = $("[data-save]", card);
    button.disabled = true;
    try {
      await api(`/api/admin/news/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          title: $("[data-edit-title]", card).value,
          text: $("[data-edit-text]", card).value,
          visible: $("[data-visible]", card).checked,
          pinned: $("[data-pinned]", card).checked,
        },
      });
      card.classList.toggle("is-hidden", !$("[data-visible]", card).checked);
      showToast("Публикация сохранена.");
    } catch (error) {
      showToast(error.message || "Не удалось сохранить публикацию.");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteCard(card) {
    if (!window.confirm("Удалить эту публикацию?")) return;
    try {
      await api(`/api/admin/news/${encodeURIComponent(card.dataset.id)}`, { method: "DELETE" });
      card.remove();
      const left = $$(".admin-news-card", list).length;
      $("#newsCount").textContent = String(left);
      if (!left) renderNews([]);
      showToast("Публикация удалена.");
    } catch (error) {
      showToast(error.message || "Не удалось удалить публикацию.");
    }
  }

  async function addNews(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $("#newNewsError");
    const button = $("button[type=submit]", form);
    if (error) error.hidden = true;
    button.disabled = true;
    try {
      await api("/api/admin/news", {
        method: "POST",
        body: {
          title: form.elements.title.value,
          category: form.elements.category.value,
          text: form.elements.text.value,
          visible: form.elements.visible.checked,
        },
      });
      form.reset();
      form.elements.visible.checked = true;
      await loadDashboard();
      showToast("Новая публикация добавлена.");
    } catch (err) {
      if (error) { error.textContent = err.message; error.hidden = false; }
    } finally {
      button.disabled = false;
    }
  }

  $("#loginForm")?.addEventListener("submit", login);
  $("#newNewsForm")?.addEventListener("submit", addNews);
  $("#syncButton")?.addEventListener("click", syncVk);
  $("#logoutButton")?.addEventListener("click", () => {
    token = "";
    sessionStorage.removeItem(tokenKey);
    showLogin("Вы вышли из панели управления.");
  });

  list?.addEventListener("click", (event) => {
    const card = event.target.closest(".admin-news-card");
    if (!card) return;
    if (event.target.closest("[data-save]")) saveCard(card);
    if (event.target.closest("[data-delete]")) deleteCard(card);
  });
  list?.addEventListener("change", (event) => {
    const card = event.target.closest(".admin-news-card");
    if (card && event.target.matches("[data-visible]")) card.classList.toggle("is-hidden", !event.target.checked);
  });

  if (token) loadDashboard();
})();
