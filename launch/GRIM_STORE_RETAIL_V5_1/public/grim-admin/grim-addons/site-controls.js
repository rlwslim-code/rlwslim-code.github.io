/*
 * ============================================================
 * GRIM SAFE SITE CONTROLS
 * Isolated frontend add-on
 * ============================================================
 *
 * File:
 * /public/grim-admin/grim-addons/site-controls.js
 *
 * Handles:
 * - Store accepting orders
 * - Announcement visibility
 * - Announcement text
 * - Maintenance mode
 *
 * Does NOT activate until deliberately loaded by index.html.
 */

(function () {
  "use strict";

  const SETTINGS_URL =
    "/api/admin/store-settings";

  let loading = false;
let saving = false;
let dirty = false;
let lastSettings = null;

  function $(id) {
    return document.getElementById(id);
  }

  function safeString(value) {
    return String(value ?? "");
  }

  function setMessage(
    text,
    type = ""
  ) {
    const message =
      $("storeSettingsMessage");

    if (!message) return;

    message.textContent =
      safeString(text);

    message.style.color =
      type === "success"
        ? "#50dc98"
        : type === "error"
        ? "#ff737c"
        : "";
  }

  async function api(
    url,
    options = {}
  ) {
    const config = {
      method:
        options.method || "GET",

      credentials:
        "include",

      cache:
        "no-store",

      headers: {
        ...(options.body !== undefined
          ? {
              "Content-Type":
                "application/json"
            }
          : {}),

        ...(options.headers || {})
      }
    };

    if (
      options.body !== undefined
    ) {
      config.body =
        JSON.stringify(
          options.body
        );
    }

    const response =
      await fetch(
        url,
        config
      );

    let data = {};

    try {
      data =
        await response.json();
    } catch (_) {}

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `Request failed (${response.status})`
      );
    }

    return data;
  }

  function applySettings(
    settings = {}
  ) {
    const ordersOpen =
      $("settingOrdersOpen");

    const announcement =
      $("settingAnnouncement");

    const maintenance =
      $("settingMaintenance");

    const announcementText =
      $("announcementText");


    if (ordersOpen) {
      ordersOpen.checked =
        settings.ordersOpen !== false;
    }

    if (announcement) {
      announcement.checked =
        settings.announcementEnabled === true;
    }

    if (maintenance) {
      maintenance.checked =
        settings.maintenanceMode === true;
    }

    if (announcementText) {
      announcementText.value =
        safeString(
          settings.announcementText
        );
    }
  }

  function collectSettings() {
    return {
      ordersOpen:
        Boolean(
          $("settingOrdersOpen")
            ?.checked
        ),

      announcementEnabled:
        Boolean(
          $("settingAnnouncement")
            ?.checked
        ),

      maintenanceMode:
        Boolean(
          $("settingMaintenance")
            ?.checked
        ),

      announcementText:
        safeString(
          $("announcementText")
            ?.value
        )
          .trim()
          .slice(
            0,
            1000
          )
    };
  }

  async function loadSettings() {
    if (loading) return;

    loading = true;

    try {
      const result =
        await api(
          SETTINGS_URL
        );

      const settings =
  result?.settings || {};

lastSettings = settings;

if (!dirty) {
  applySettings(
    settings
  );
}

      if (
        settings.setupRequired
      ) {
        setMessage(
          "Settings storage needs to be created before changes can be saved.",
          "error"
        );
      } else if (
        settings.persisted === false
      ) {
        setMessage(
          "Using default store settings."
        );
      } else {
        setMessage(
          "Store settings loaded.",
          "success"
        );
      }

    } catch (error) {
      console.warn(
        "[GRIM SITE CONTROLS]",
        error
      );

      setMessage(
        error?.message ||
        "Unable to load store settings.",
        "error"
      );

    } finally {
      loading = false;
    }
  }

  async function saveSettings(
    event
  ) {
    event?.preventDefault();
    event?.stopPropagation();

    if (saving) return;

    saving = true;

    const button =
      $("saveStoreSettings");

    if (button) {
      button.disabled = true;
      button.textContent =
        "SAVING…";
    }

    setMessage(
      "Saving store settings…"
    );

    try {
      const payload =
        collectSettings();

      const result =
        await api(
          SETTINGS_URL,
          {
            method: "PUT",
            body: payload
          }
        );
      lastSettings =
  result?.settings || payload;

dirty = false;
      applySettings(
        result?.settings ||
        payload
      );

      setMessage(
        "Store settings saved.",
        "success"
      );

    } catch (error) {
      console.error(
        "[GRIM SITE CONTROLS] save:",
        error
      );

      setMessage(
        error?.message ||
        "Unable to save store settings.",
        "error"
      );

    } finally {
      saving = false;

      if (button) {
        button.disabled = false;
        button.textContent =
          "SAVE STORE SETTINGS";
      }
    }
  }

  /*
   * The original admin.js already attaches
   * an old disabled save handler to this button.
   *
   * Replacing the button with an identical clone
   * safely removes that old handler without editing
   * the existing admin.js file.
   */
  function installSaveButton() {
    const existing =
      $("saveStoreSettings");

    if (!existing) {
      return null;
    }

    if (
      existing.dataset
        .grimSiteControls === "1"
    ) {
      return existing;
    }

    const replacement =
      existing.cloneNode(true);

    replacement.dataset
      .grimSiteControls = "1";

    existing.replaceWith(
      replacement
    );

    replacement
      .addEventListener(
        "click",
        saveSettings
      );

    return replacement;
  }

  function storePanelVisible() {
    const panel =
      $("panel-store");

    return Boolean(
      panel &&
      panel.classList.contains(
        "active"
      )
    );
  }

  function adminVisible() {
    const admin =
      $("adminApp");

    return Boolean(
      admin &&
      !admin.classList.contains(
        "hidden"
      )
    );
  }

  function bindNavigation() {
    const storeButton =
      document.querySelector(
        '[data-panel="store"]'
      );

    storeButton
      ?.addEventListener(
        "click",
        () => {
          setTimeout(
            () => {
              installSaveButton();
              loadSettings();
            },
            100
          );
        }
      );


    $("refreshDashboard")
      ?.addEventListener(
        "click",
        () => {
          /*
           * Existing dashboard refresh may redraw
           * default values first.
           * Load our persisted values afterward.
           */
          setTimeout(
            () => {
              if (
                storePanelVisible()
              ) {
                installSaveButton();
                loadSettings();
              }
            },
            700
          );
        }
      );
  }

  function watchAdminLogin() {
    const admin =
      $("adminApp");

    if (!admin) return;

    const observer =
      new MutationObserver(
        () => {
          if (
            adminVisible()
          ) {
            installSaveButton();

            if (
              storePanelVisible()
            ) {
              loadSettings();
            }
          }
        }
      );

    observer.observe(
      admin,
      {
        attributes: true,
        attributeFilter: [
          "class"
        ]
      }
    );
  }

  function start() {
  installSaveButton();

  bindNavigation();

  watchAdminLogin();

  const controls = [
    $("settingOrdersOpen"),
    $("settingAnnouncement"),
    $("settingMaintenance"),
    $("announcementText")
  ];

  controls.forEach(control => {
    control?.addEventListener(
      control?.tagName === "TEXTAREA"
        ? "input"
        : "change",
      () => {
        dirty = true;
      }
    );
  });

  if (
    adminVisible() &&
    storePanelVisible()
  ) {
    loadSettings();
  }

  /*
   * The original GRIM dashboard redraws its old
   * default settings during dashboard refreshes.
   *
   * When there are no unsaved admin changes,
   * quietly restore the persisted GRIM settings.
   */
    if (
    adminVisible() &&
    storePanelVisible()
  ) {
    loadSettings();
  }
}

start();
})();
