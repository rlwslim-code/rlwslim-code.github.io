/*
 * ============================================================
 * GRIM PRODUCT ADMIN ADD-ON
 * Isolated backend extension
 * ============================================================
 *
 * File:
 * /src/grim-control/grim-addons/product-admin.js
 *
 * Handles:
 * - Create product
 * - Edit product
 * - Hide / show product
 * - Delete product
 *
 * This file does NOT activate itself.
 * We will connect it deliberately after it is committed.
 */

import {
  grimSupabase,
  grimSupabaseReady
} from "../supabase.js";


const PRODUCT_FIELDS =
  "id,name,type,price,color,image,active,sort_order";


function safeString(
  value = ""
) {
  return String(
    value ?? ""
  );
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
  fallback = true
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


function cleanProduct(
  body = {}
) {
  const price =
    Number(
      body.price
    );

  const sortOrder =
    Number(
      body.sort_order ?? 0
    );

  return {
    name:
      safeString(
        body.name
      ).trim(),

    type:
      safeString(
        body.type
      ).trim(),

    price:
      Number.isFinite(price)
        ? price
        : NaN,

    color:
      safeString(
        body.color
      ).trim(),

    image:
      safeString(
        body.image
      ).trim(),

    active:
  toBoolean(
    body.active,
    true
  )
    ? 1
    : 0,

    sort_order:
      Number.isFinite(
        sortOrder
      )
        ? Math.trunc(
            sortOrder
          )
        : 0
  };
}


function validateProduct(
  product
) {
  if (!product.name) {
    return (
      "Product name is required."
    );
  }

  if (
    !Number.isFinite(
      product.price
    ) ||
    product.price < 0
  ) {
    return (
      "Product price must be a valid positive number."
    );
  }

  return null;
}


function databaseReady(
  res
) {
  if (
    !grimSupabase ||
    !grimSupabaseReady()
  ) {
    res
      .status(503)
      .json({
        ok: false,
        error:
          "Product database is not configured."
      });

    return false;
  }

  return true;
}


/*
 * ============================================================
 * INSTALL ROUTES
 * ============================================================
 */

export function installGrimProductAdmin(
  app
) {
  if (!app) {
    throw new Error(
      "GRIM Product Admin requires the Express app."
    );
  }

  if (
    app.locals
      ?.grimProductAdminInstalled
  ) {
    return;
  }

  app.locals
    .grimProductAdminInstalled =
      true;


  /*
   * ----------------------------------------------------------
   * CREATE PRODUCT
   * POST /api/admin/products
   * ----------------------------------------------------------
   */

  app.post(
    "/api/admin/products",
    adminOnly,
    async (
      req,
      res
    ) => {

      noCache(res);

      if (
        !databaseReady(res)
      ) {
        return;
      }

      const product =
        cleanProduct(
          req.body
        );

      const validationError =
        validateProduct(
          product
        );

      if (validationError) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              validationError
          });
      }

      try {

        const {
          data,
          error
        } =
          await grimSupabase
            .from(
              "products"
            )
            .insert(
              product
            )
            .select(
              PRODUCT_FIELDS
            )
            .single();


        if (error) {
          throw error;
        }


        return res
          .status(201)
          .json({
            ok: true,
            product:
              data
          });

      } catch (error) {

        console.error(
          "[GRIM PRODUCT ADMIN] create:",
          error
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              error?.message ||
              "Unable to create product."
          });
      }
    }
  );


  /*
   * ----------------------------------------------------------
   * UPDATE PRODUCT
   * PUT /api/admin/products/:id
   * ----------------------------------------------------------
   */

  app.put(
    "/api/admin/products/:id",
    adminOnly,
    async (
      req,
      res
    ) => {

      noCache(res);

      if (
        !databaseReady(res)
      ) {
        return;
      }

      const id =
        safeString(
          req.params?.id
        ).trim();

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Product ID is required."
          });
      }


      const product =
        cleanProduct(
          req.body
        );

      const validationError =
        validateProduct(
          product
        );

      if (validationError) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              validationError
          });
      }


      try {

        const {
          data,
          error
        } =
          await grimSupabase
            .from(
              "products"
            )
            .update(
              product
            )
            .eq(
              "id",
              id
            )
            .select(
              PRODUCT_FIELDS
            )
            .single();


        if (error) {
          throw error;
        }


        return res.json({
          ok: true,
          product:
            data
        });

      } catch (error) {

        console.error(
          "[GRIM PRODUCT ADMIN] update:",
          error
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              error?.message ||
              "Unable to update product."
          });
      }
    }
  );


  /*
   * ----------------------------------------------------------
   * DELETE PRODUCT
   * DELETE /api/admin/products/:id
   * ----------------------------------------------------------
   */

  app.delete(
    "/api/admin/products/:id",
    adminOnly,
    async (
      req,
      res
    ) => {

      noCache(res);

      if (
        !databaseReady(res)
      ) {
        return;
      }

      const id =
        safeString(
          req.params?.id
        ).trim();

      if (!id) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Product ID is required."
          });
      }


      try {

        const {
          error
        } =
          await grimSupabase
            .from(
              "products"
            )
            .delete()
            .eq(
              "id",
              id
            );


        if (error) {
          throw error;
        }


        return res.json({
          ok: true,
          deleted:
            id
        });

      } catch (error) {

        console.error(
          "[GRIM PRODUCT ADMIN] delete:",
          error
        );

        return res
          .status(500)
          .json({
            ok: false,
            error:
              error?.message ||
              "Unable to delete product."
          });
      }
    }
  );


  console.log(
    "[GRIM PRODUCT ADMIN] routes installed."
  );
}
