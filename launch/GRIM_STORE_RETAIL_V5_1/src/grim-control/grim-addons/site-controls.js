/*
 * ============================================================
 * GRIM SITE CONTROLS ADD-ON
 * Isolated backend extension
 * ============================================================
 *
 * File:
 * /src/grim-control/grim-addons/site-controls.js
 *
 * This file does NOT activate itself.
 */

import {
  grimSupabase,
  grimSupabaseReady
} from "../supabase.js";


const SETTINGS_TABLE =
  "grim_settings";

const SETTINGS_KEY =
  "store";


const DEFAULT_SETTINGS = {
  ordersOpen: true,
  announcementEnabled: false,
  maintenanceMode: false,
  announcementText: ""
};


function safeString(value = "") {
  return String(value ?? "");
}


function noCache(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );
}


function adminOnly(
  req,
  res,
  next
) {
  if (
    req?.session?.admin === true
  ) {
    return next();
  }

  return res
    .status(401)
    .json({
      ok: false,
      error:
        "Admin authentication required."
    });
}


function toBoolean(
  value,
  fallback = false
) {
  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  const text =
    safeString(value)
      .trim()
      .toLowerCase();

  if (
    text === "true" ||
    text === "1" ||
    text === "yes"
  ) {
    return true;
  }

  if (
    text === "false" ||
    text === "0" ||
    text === "no"
  ) {
    return false;
  }

  return fallback;
}


function cleanSettings(
  value = {}
) {
  return {
    ordersOpen:
      toBoolean(
        value.ordersOpen,
        true
      ),

    announcementEnabled:
      toBoolean(
        value.announcementEnabled,
        false
      ),

    maintenanceMode:
      toBoolean(
        value.maintenanceMode,
        false
      ),

    announcementText:
      safeString(
        value.announcementText
      )
        .trim()
        .slice(
          0,
          1000
        )
  };
}


function databaseReady() {
  return Boolean(
    grimSupabase &&
    grimSupabaseReady()
  );
}


function tableMissing(error) {
  const message =
    safeString(
      error?.message
    ).toLowerCase();

  return (
    message.includes(
      "does not exist"
    ) ||
    message.includes(
      "could not find"
    ) ||
    message.includes(
      "schema cache"
    )
  );
}


/*
 * ============================================================
 * LOAD SETTINGS
 * ============================================================
 */

async function loadSettings() {

  if (!databaseReady()) {
    return {
      ...DEFAULT_SETTINGS,
      persisted: false
    };
  }

  const {
    data,
    error
  } =
    await grimSupabase
      .from(
        SETTINGS_TABLE
      )
      .select(
        "key,value"
      )
      .eq(
        "key",
        SETTINGS_KEY
      )
      .maybeSingle();


  if (error) {

    if (tableMissing(error)) {
      return {
        ...DEFAULT_SETTINGS,
        persisted: false,
        setupRequired: true
      };
    }

    throw error;
  }


  if (!data?.value) {
    return {
      ...DEFAULT_SETTINGS,
      persisted: true
    };
  }


  return {
    ...cleanSettings(
      data.value
    ),
    persisted: true
  };
}


/*
 * ============================================================
 * SAVE SETTINGS
 * ============================================================
 */

async function saveSettings(
  settings
) {

  if (!databaseReady()) {
    throw new Error(
      "Supabase is not configured."
    );
  }


  const cleaned =
    cleanSettings(
      settings
    );


  const {
    data,
    error
  } =
    await grimSupabase
      .from(
        SETTINGS_TABLE
      )
      .upsert(
        {
          key:
            SETTINGS_KEY,

          value:
            cleaned,

          updated_at:
            new Date()
              .toISOString()
        },
        {
          onConflict:
            "key"
        }
      )
      .select(
        "key,value"
      )
      .single();


  if (error) {

    if (tableMissing(error)) {
      throw new Error(
        "GRIM settings table has not been created yet."
      );
    }

    throw error;
  }


  return {
    ...cleanSettings(
      data?.value ||
      cleaned
    ),
    persisted: true
  };
}


/*
 * ============================================================
 * INSTALL ROUTES
 * ============================================================
 */

export function installGrimSiteControls(
  app
) {

  if (!app) {
    throw new Error(
      "GRIM Site Controls requires the Express app."
    );
  }


  if (
    app.locals
      ?.grimSiteControlsInstalled
  ) {
    return;
  }


  app.locals
    .grimSiteControlsInstalled =
      true;


  /*
   * ----------------------------------------------------------
   * PUBLIC STORE SETTINGS
   *
   * Storefront can later read this endpoint.
   * ----------------------------------------------------------
   */

  app.get(
    "/api/store/settings",
    async (
      req,
      res
    ) => {

      noCache(res);

      try {

        const settings =
          await loadSettings();

        return res.json({
          ok: true,
          settings
        });

      } catch (error) {

        console.error(
          "[GRIM SITE CONTROLS] public settings:",
          error
        );

        return res.json({
          ok: true,
          settings: {
            ...DEFAULT_SETTINGS,
            persisted: false
          }
        });
      }
    }
  );


  /*
   * ----------------------------------------------------------
   * ADMIN READ SETTINGS
   * ----------------------------------------------------------
   */

  app.get(
    "/api/admin/store-settings",
    adminOnly,
    async (
      req,
      res
    ) => {

      noCache(res);

      try {

        const settings =
          await loadSettings();

        return res.json({
          ok: true,
          settings
        });

      } catch (error) {

        console.error(
          "[GRIM SITE CONTROLS] admin read:",
          error
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              error?.message ||
              "Unable to load store settings."
          });
      }
    }
  );


  /*
   * ----------------------------------------------------------
   * ADMIN SAVE SETTINGS
   * ----------------------------------------------------------
   */

  app.put(
    "/api/admin/store-settings",
    adminOnly,
    async (
      req,
      res
    ) => {

      noCache(res);

      try {

        const settings =
          await saveSettings(
            req.body || {}
          );


        return res.json({
          ok: true,
          settings
        });

      } catch (error) {

        console.error(
          "[GRIM SITE CONTROLS] save:",
          error
        );


        return res
          .status(500)
          .json({
            ok: false,
            error:
              error?.message ||
              "Unable to save store settings."
          });
      }
    }
  );


  console.log(
    "[GRIM SITE CONTROLS] routes installed."
  );
}
