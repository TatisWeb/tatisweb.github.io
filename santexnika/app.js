"use strict";

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const header = $("#siteHeader");
  const navToggle = $("#navToggle");
  const nav = $("#primaryNav");
  const leadDialog = $("#leadDialog");
  const successDialog = $("#successDialog");
  const leadForm = $("#leadForm");
  const productGrid = $("#productGrid");
  const newsGrid = $("#newsGrid");
  const formError = $("#formError");
  let products = [];
  let activeFilter = "all";

  const CATEGORY_LABELS = {
    bath: "Ванны",
    furniture: "Мебель для ванной",
    basin: "Раковины",
    faucet: "Смесители",
    shower: "Душевые системы",
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function safeExternalUrl(value, fallback = "https://vk.ru/houseplumbers") {
    try {
      const url = new URL(value, window.location.origin);
      return ["https:", "http:"].includes(url.protocol) ? url.href : fallback;
    } catch {
      return fallback;
    }
  }

  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function setPhoneLinks(config) {
    if (!config) return;
    const phone = config.phone || "+7 (960) 359-37-39";
    const href = config.phoneHref || "+79603593739";
    $$('a[href^="tel:"]').forEach((link) => {
      link.href = `tel:${href}`;
      const label = $("strong", link);
      if (label && label.closest(".contact-primary")) label.textContent = phone;
      const phoneSpan = $(".header-phone span", link);
      if (phoneSpan) phoneSpan.textContent = phone.replace(/[()]/g, "");
    });
    $$('a[href^="mailto:"]').forEach((link) => {
      const email = config.email || "dom-santehniki@mail.ru";
      link.href = `mailto:${email}`;
      if (link.textContent.includes("@")) link.textContent = email;
    });
    const vk = config.vkUrl || "https://vk.ru/houseplumbers";
    $$('a[href*="vk.ru/houseplumbers"]').forEach((link) => link.href = safeExternalUrl(vk));
    if (config.whatsappUrl) {
      $$('a[href*="wa.me/"]').forEach((link) => link.href = safeExternalUrl(config.whatsappUrl));
    }
    $$('[data-public-social]').forEach((link) => {
      const destination = config[link.dataset.publicSocial];
      if (destination) {
        link.href = safeExternalUrl(destination);
        link.hidden = false;
      } else {
        link.hidden = true;
      }
    });
    if (config.addresses && config.addresses.length >= 2) {
      const branches = $$(".branch-card");
      branches.forEach((branch, index) => {
        const p = $("p", branch);
        if (p) {
          const address = config.addresses[index];
          const weekdays = escapeHtml(config.hours?.weekdays || "Пн–Пт: 09:00–19:00");
          const weekends = escapeHtml(config.hours?.weekends || "Сб–Вс: 09:00–17:00");
          if (address) p.innerHTML = `${escapeHtml(address)}<br>${weekdays} · ${weekends}`;
        }
      });
    }
  }

  function makeProductCard(product) {
    const name = escapeHtml(product.name);
    const image = product.image && (product.image.startsWith("/") || product.image.startsWith("https://")) ? product.image : "/assets/catalog/bath-aura.jpg";
    const source = safeExternalUrl(product.sourceUrl);
    const price = product.priceLabel || (Number(product.price) ? `${new Intl.NumberFormat("ru-RU").format(product.price)} ₽` : "Уточнить цену");
    const category = CATEGORY_LABELS[product.category] || "Сантехника";
    const specs = escapeHtml(product.specs || "Подробности уточняйте у консультанта");
    const badge = product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : "";
    return `<article class="product-card" data-product-card data-category="${escapeHtml(product.category || "other")}" data-name="${name.toLocaleLowerCase("ru-RU")}">
      <div class="product-image-wrap"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.imageAlt || product.name)}" loading="lazy" width="400" height="400">${badge}<a class="product-image-link" href="${escapeHtml(source)}" target="_blank" rel="noopener" aria-label="Подробнее о товаре ${name} в каталоге группы">↗</a></div>
      <div class="product-info"><p class="product-category-label">${escapeHtml(category)}</p><h3>${name}</h3><p class="product-specs">${specs}</p><div class="product-bottom"><strong class="product-price">${escapeHtml(String(price).replace(/\s*₽$/, ""))} <small>₽</small></strong><button class="button button-outline" type="button" data-request-product="${name}">Уточнить наличие</button></div></div>
    </article>`;
  }

  function applyProductFilters() {
    const term = $("#catalogSearch")?.value.trim().toLocaleLowerCase("ru-RU") || "";
    const cards = $$("[data-product-card]", productGrid);
    let visible = 0;
    cards.forEach((card) => {
      const categoryMatch = activeFilter === "all" || card.dataset.category === activeFilter;
      const nameMatch = !term || `${card.dataset.name} ${card.textContent}`.toLocaleLowerCase("ru-RU").includes(term);
      card.hidden = !(categoryMatch && nameMatch);
      if (!card.hidden) visible += 1;
    });
    let empty = $(".product-empty", productGrid);
    if (visible === 0) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "product-empty news-empty";
        empty.textContent = "Не нашли нужное? Оставьте заявку — уточним ассортимент и поможем с подбором.";
        productGrid.append(empty);
      }
      empty.hidden = false;
    } else if (empty) empty.hidden = true;
  }

  function setActiveFilter(filter) {
    activeFilter = filter || "all";
    $$("[data-filter]").forEach((button) => {
      const active = button.dataset.filter === activeFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    applyProductFilters();
  }

  async function loadProducts() {
    if (!productGrid) return;
    try {
      let data;
      try { data = await getJson("/api/products"); }
      catch { data = await getJson("/data/products.json"); }
      if (!Array.isArray(data) || !data.length) return;
      products = data;
      productGrid.innerHTML = products.map(makeProductCard).join("");
      applyProductFilters();
    } catch (error) {
      console.info("Используется каталог, встроенный в страницу.", error.message);
      applyProductFilters();
    }
  }

  function formatRussianDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
  }

  function makeNewsCard(item, index) {
    const title = escapeHtml(item.title || "Новости магазина");
    const text = escapeHtml(item.text || "");
    const category = escapeHtml(item.category || "Из сообщества");
    const date = formatRussianDate(item.date);
    const source = safeExternalUrl(item.sourceUrl);
    const imageUrl = item.image && /^https:\/\//i.test(item.image) ? safeExternalUrl(item.image, "") : "";
    const image = imageUrl
      ? `<div class="news-photo"><img src="${escapeHtml(imageUrl)}" alt="Иллюстрация к публикации «${title}»" loading="lazy"></div>`
      : "";
    return `<article class="news-card${image ? " has-news-photo" : ""}" data-news-index="${index}"><div class="news-card-top"><span class="news-tag">${category}</span><time datetime="${escapeHtml(item.date || "")}">${escapeHtml(date)}</time></div>${image}<h3>${title}</h3><p>${text}</p><a class="news-link" href="${escapeHtml(source)}" target="_blank" rel="noopener">Читать в сообществе <span aria-hidden="true">↗</span></a></article>`;
  }

  async function loadNews() {
    if (!newsGrid) return;
    try {
      let data;
      try { data = await getJson("/api/news?limit=3"); }
      catch { data = await getJson("/data/news.json"); }
      if (!Array.isArray(data) || !data.length) return;
      newsGrid.innerHTML = data.slice(0, 3).map(makeNewsCard).join("");
    } catch (error) {
      console.info("Используются публикации, встроенные в страницу.", error.message);
    }
  }

  async function loadStatus() {
    const statusLabel = $("#newsStatus");
    if (!statusLabel) return;
    try {
      const status = await getJson("/api/health");
      const vk = status.vk || {};
      if (vk.status === "ok" && vk.lastSync) {
        statusLabel.textContent = `Обновлено из VK · ${formatRussianDate(vk.lastSync)}`;
      } else if (vk.connected && vk.status !== "not_configured") {
        statusLabel.textContent = "Подключение к сообществу активировано";
      } else {
        statusLabel.textContent = "Публикации магазина · ВКонтакте";
      }
    } catch {
      statusLabel.textContent = "Публикации магазина · ВКонтакте";
    }
  }

  function closeMobileNav() {
    if (!navToggle || !nav) return;
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Открыть меню");
    nav.classList.remove("is-open");
  }

  function openLead(topic, product = "") {
    if (!leadDialog) return;
    const topicField = $("#formTopic");
    const productField = $("#formProduct");
    const comment = $("#leadComment");
    if (topicField) topicField.value = topic || "Консультация";
    if (productField) productField.value = product || "";
    if (comment && product) comment.value = `Интересует товар: ${product}`;
    if (formError) { formError.hidden = true; formError.textContent = ""; }
    if (typeof leadDialog.showModal === "function") leadDialog.showModal();
    else leadDialog.setAttribute("open", "");
    window.setTimeout(() => $("#leadName")?.focus(), 80);
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function showFormError(message) {
    if (!formError) return;
    formError.textContent = message;
    formError.hidden = false;
  }

  function phoneDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  async function submitLead(event) {
    event.preventDefault();
    if (!leadForm) return;
    const name = $("#leadName").value.trim();
    const phone = $("#leadPhone").value.trim();
    const consent = $("#leadConsent").checked;
    const button = $(".button-submit", leadForm);
    const digits = phoneDigits(phone);
    if (name.length < 2) return showFormError("Укажите, пожалуйста, как к вам обращаться.");
    if (digits.length < 10 || digits.length > 15) return showFormError("Проверьте номер телефона — в нём должно быть не менее 10 цифр.");
    if (!consent) return showFormError("Для отправки заявки подтвердите согласие на обработку данных.");
    if (formError) { formError.hidden = true; formError.textContent = ""; }

    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = "<span>Отправляем…</span><span aria-hidden=\"true\">…</span>";
    const payload = {
      name,
      phone,
      topic: $("#formTopic").value,
      product: $("#formProduct").value,
      comment: $("#leadComment").value.trim(),
      website: leadForm.elements.website.value,
      consent,
    };
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.message || "Не удалось отправить заявку.");
      closeDialog(leadDialog);
      leadForm.reset();
      if ($("#formTopic")) $("#formTopic").value = "Консультация";
      if ($("#formProduct")) $("#formProduct").value = "";
      if (typeof successDialog.showModal === "function") successDialog.showModal();
      else successDialog.setAttribute("open", "");
    } catch (error) {
      showFormError(`${error.message || "Не удалось отправить заявку."} Позвоните нам: +7 (960) 359-37-39.`);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function formatRuPhone(input) {
    const raw = input.value;
    let digits = phoneDigits(raw);
    if (!digits) return;
    if (digits[0] === "8") digits = `7${digits.slice(1)}`;
    if (digits[0] !== "7") digits = `7${digits}`;
    digits = digits.slice(0, 11);
    const local = digits.slice(1);
    let formatted = "+7";
    if (local.length) formatted += ` (${local.slice(0, 3)}`;
    if (local.length >= 3) formatted += ")";
    if (local.length > 3) formatted += ` ${local.slice(3, 6)}`;
    if (local.length > 6) formatted += `-${local.slice(6, 8)}`;
    if (local.length > 8) formatted += `-${local.slice(8, 10)}`;
    input.value = formatted;
  }

  document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-lead]");
    if (openButton) {
      event.preventDefault();
      openLead(openButton.dataset.topic || "Консультация");
    }
    const productButton = event.target.closest("[data-request-product]");
    if (productButton) {
      openLead("Уточнить наличие и цену", productButton.dataset.requestProduct || "");
    }
    const filterLink = event.target.closest("[data-category-link]");
    if (filterLink) {
      setActiveFilter(filterLink.dataset.categoryLink);
    }
    if (event.target.closest("[data-close-lead]")) closeDialog(leadDialog);
    if (event.target.closest("[data-close-success]")) closeDialog(successDialog);
  });

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const expanded = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!expanded));
      navToggle.setAttribute("aria-label", expanded ? "Открыть меню" : "Закрыть меню");
      nav.classList.toggle("is-open", !expanded);
    });
    $$('a[href^="#"]', nav).forEach((link) => link.addEventListener("click", closeMobileNav));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobileNav(); });
  }

  $$('[data-filter]').forEach((button) => button.addEventListener("click", () => setActiveFilter(button.dataset.filter)));
  $("#catalogSearch")?.addEventListener("input", applyProductFilters);
  leadForm?.addEventListener("submit", submitLead);
  $("#leadPhone")?.addEventListener("input", (event) => formatRuPhone(event.currentTarget));

  [leadDialog, successDialog].forEach((dialog) => {
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  $$(".faq-item").forEach((item) => item.addEventListener("toggle", () => {
    if (!item.open) return;
    $$(".faq-item").forEach((other) => { if (other !== item) other.open = false; });
  }));

  const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });
  const year = $("#currentYear");
  if (year) year.textContent = String(new Date().getFullYear());

  Promise.allSettled([loadProducts(), loadNews(), loadStatus(), getJson("/api/config").then(setPhoneLinks)]);
})();
