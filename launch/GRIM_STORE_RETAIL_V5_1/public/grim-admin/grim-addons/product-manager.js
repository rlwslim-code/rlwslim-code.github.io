/*
 * ============================================================
 * GRIM PRODUCT MANAGER ADD-ON
 * Isolated admin extension
 * ============================================================
 *
 * File:
 * /public/grim-admin/grim-addons/product-manager.js
 *
 * This file does NOT replace the existing GRIM admin.
 * It will only become active after we deliberately connect it.
 */

(function () {
  "use strict";

  const SNAPSHOT_URL =
    "/api/admin/control/snapshot";

  const PRODUCTS_API =
    "/api/admin/products";

  let products = [];
  let editingProduct = null;
  let rendering = false;
  let refreshTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function safeString(value) {
    return String(value ?? "");
  }

  function escapeHtml(value) {
    return safeString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMoney(value) {
    const amount =
      Number(value || 0);

    try {
      return new Intl.NumberFormat(
        "en-NG",
        {
          style: "currency",
          currency: "NGN",
          maximumFractionDigits: 0
        }
      ).format(amount);
    } catch (_) {
      return `₦${amount}`;
    }
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

  function injectStyles() {
    if (
      $("grimProductAddonStyles")
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "grimProductAddonStyles";

    style.textContent = `
      .grim-product-addon {
        display: grid;
        gap: 18px;
      }

      .grim-product-toolbar {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .grim-product-toolbar h3 {
        margin: 0;
        font-size: 18px;
      }

      .grim-product-btn {
        border: 1px solid rgba(255,255,255,.12);
        background: #17171b;
        color: #fff;
        padding: 12px 16px;
        border-radius: 12px;
        font: inherit;
        cursor: pointer;
      }

      .grim-product-btn.primary {
        border: 0;
        background:
          linear-gradient(
            100deg,
            #7d0b42,
            #b11962,
            #4050c8
          );
        font-weight: 700;
      }

      .grim-product-btn.danger {
        color: #ff727b;
      }

      .grim-product-grid {
        display: grid;
        gap: 14px;
      }

      .grim-product-card {
        display: grid;
        grid-template-columns:
          100px minmax(0, 1fr);
        gap: 16px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(255,255,255,.025);
        border:
          1px solid rgba(255,255,255,.08);
      }

      .grim-product-image {
        width: 100px;
        height: 125px;
        border-radius: 14px;
        overflow: hidden;
        background: #16161a;
        border:
          1px solid rgba(255,255,255,.08);
      }

      .grim-product-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .grim-product-no-image {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        color: #777;
        font-size: 11px;
        text-align: center;
        padding: 8px;
      }

      .grim-product-info {
        min-width: 0;
      }

      .grim-product-info h4 {
        margin: 0 0 7px;
        font-size: 18px;
      }

      .grim-product-meta {
        color: #aaa;
        font-size: 13px;
        margin-top: 5px;
      }

      .grim-product-price {
        font-size: 18px;
        margin-top: 4px;
      }

      .grim-product-status {
        display: inline-flex;
        margin-top: 7px;
        padding: 5px 9px;
        border-radius: 999px;
        background: rgba(58,211,137,.12);
        color: #50dc98;
        font-size: 12px;
      }

      .grim-product-status.hidden-product {
        background: rgba(255,90,100,.12);
        color: #ff737c;
      }

      .grim-product-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }

      .grim-product-actions button {
        padding: 8px 11px;
        border-radius: 9px;
        border:
          1px solid rgba(255,255,255,.10);
        background: #151519;
        color: #fff;
        font: inherit;
        font-size: 12px;
      }

      .grim-product-form {
        display: grid;
        gap: 14px;
        padding: 18px;
        border-radius: 18px;
        border:
          1px solid rgba(255,255,255,.09);
        background: #111114;
      }

      .grim-product-form h3 {
        margin: 0 0 5px;
      }

      .grim-field {
        display: grid;
        gap: 7px;
      }

      .grim-field label {
        color: #aaa;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .08em;
      }

      .grim-field input,
      .grim-field select {
        width: 100%;
        box-sizing: border-box;
        padding: 13px 14px;
        border-radius: 12px;
        border:
          1px solid rgba(255,255,255,.10);
        background: #18181c;
        color: #fff;
        font: inherit;
      }

      .grim-field-row {
        display: grid;
        grid-template-columns:
          repeat(2, minmax(0,1fr));
        gap: 12px;
      }

      .grim-product-preview {
        width: 100%;
        max-width: 230px;
        aspect-ratio: 4 / 5;
        overflow: hidden;
        border-radius: 15px;
        background: #18181c;
        border:
          1px solid rgba(255,255,255,.08);
      }

      .grim-product-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .grim-product-message {
        font-size: 13px;
        color: #aaa;
      }

      .grim-product-message.error {
        color: #ff737c;
      }

      .grim-product-message.success {
        color: #50dc98;
      }

      @media (max-width: 600px) {
        .grim-product-card {
          grid-template-columns:
            86px minmax(0,1fr);
        }

        .grim-product-image {
          width: 86px;
          height: 108px;
        }

        .grim-field-row {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function getContainer() {
    return $("productManager");
  }

  function productImageMarkup(
    product
  ) {
    const image =
      safeString(
        product.image
      ).trim();

    const name =
      safeString(
        product.name ||
        "GRIM product"
      );

    if (!image) {
      return `
        <div class="grim-product-no-image">
          NO IMAGE
        </div>
      `;
    }

    return `
      <img
        src="${escapeHtml(image)}"
        alt="${escapeHtml(name)}"
        loading="lazy"
        onerror="
          this.style.display='none';
          this.parentElement.innerHTML=
            '<div class=&quot;grim-product-no-image&quot;>IMAGE UNAVAILABLE</div>';
        "
      >
    `;
  }

  function productCard(
    product
  ) {
    const id =
      safeString(product.id);

    return `
      <article
        class="grim-product-card"
        data-product-id="${escapeHtml(id)}"
      >

        <div class="grim-product-image">
          ${productImageMarkup(
            product
          )}
        </div>

        <div class="grim-product-info">

          <h4>
            ${escapeHtml(
              product.name ||
              "Unnamed product"
            )}
          </h4>

          <div class="grim-product-price">
            ${escapeHtml(
              formatMoney(
                product.price
              )
            )}
          </div>

          ${
            product.type
              ? `
                <div class="grim-product-meta">
                  Type:
                  ${escapeHtml(
                    product.type
                  )}
                </div>
              `
              : ""
          }

          ${
            product.color
              ? `
                <div class="grim-product-meta">
                  Color:
                  ${escapeHtml(
                    product.color
                  )}
                </div>
              `
              : ""
          }

          <span
            class="
              grim-product-status
              ${
                product.active === false
                  ? "hidden-product"
                  : ""
              }
            "
          >
            ${
              product.active === false
                ? "Hidden"
                : "Visible"
            }
          </span>

          <div class="grim-product-actions">

            <button
              type="button"
              data-grim-edit="${escapeHtml(id)}"
            >
              Edit
            </button>

            <button
              type="button"
              data-grim-toggle="${escapeHtml(id)}"
            >
              ${
                product.active === false
                  ? "Show"
                  : "Hide"
              }
            </button>

            <button
              type="button"
              data-grim-delete="${escapeHtml(id)}"
            >
              Delete
            </button>

          </div>

        </div>

      </article>
    `;
  }

  function renderProducts() {
    const container =
      getContainer();

    if (!container) return;

    rendering = true;

    container.dataset.grimAddon =
      "product-manager";

    container.innerHTML = `
      <div class="grim-product-addon">

        <div class="grim-product-toolbar">

          <h3>
            Products
          </h3>

          <button
            type="button"
            class="
              grim-product-btn
              primary
            "
            id="grimAddProduct"
          >
            + ADD PRODUCT
          </button>

        </div>

        <div
          id="grimProductFormArea"
        ></div>

        <div
          class="grim-product-grid"
          id="grimProductList"
        >
          ${
            products.length
              ? products
                  .map(
                    productCard
                  )
                  .join("")
              : `
                <p>
                  No products loaded.
                </p>
              `
          }
        </div>

      </div>
    `;

    bindProductEvents();

    rendering = false;
  }

  function showForm(
    product = null
  ) {
    editingProduct =
      product || null;

    const area =
      $("grimProductFormArea");

    if (!area) return;

    const data =
      product || {};

    area.innerHTML = `
      <form
        class="grim-product-form"
        id="grimProductForm"
      >

        <h3>
          ${
            product
              ? "Edit Product"
              : "Add New Product"
          }
        </h3>

        <div class="grim-field">

          <label>
            PRODUCT NAME
          </label>

          <input
            id="grimProductName"
            type="text"
            value="${escapeHtml(
              data.name || ""
            )}"
            placeholder="e.g. Abyss"
            required
          >

        </div>

        <div class="grim-field-row">

          <div class="grim-field">

            <label>
              TYPE
            </label>

            <input
              id="grimProductType"
              type="text"
              value="${escapeHtml(
                data.type || ""
              )}"
              placeholder="e.g. Hoodie"
            >

          </div>

          <div class="grim-field">

            <label>
              COLOR
            </label>

            <input
              id="grimProductColor"
              type="text"
              value="${escapeHtml(
                data.color || ""
              )}"
              placeholder="e.g. Black"
            >

          </div>

        </div>

        <div class="grim-field-row">

          <div class="grim-field">

            <label>
              PRICE (NGN)
            </label>

            <input
              id="grimProductPrice"
              type="number"
              min="0"
              step="1"
              value="${escapeHtml(
                data.price ?? ""
              )}"
              placeholder="28000"
              required
            >

          </div>

          <div class="grim-field">

            <label>
              SORT ORDER
            </label>

            <input
              id="grimProductSort"
              type="number"
              step="1"
              value="${escapeHtml(
                data.sort_order ?? 0
              )}"
            >

          </div>

        </div>

        <div class="grim-field">

  <label>
    PRODUCT IMAGE
  </label>

  <input
    id="grimProductImageFile"
    type="file"
    accept="image/*"
  >

  <input
    id="grimProductImage"
    type="hidden"
    value="${escapeHtml(
      data.image || ""
    )}"
  >

  <div class="grim-product-message">
    ${
      data.image
        ? "Choose a new image only if you want to replace the current image."
        : "Choose a photo from your device."
    }
  </div>

</div>

        <div class="grim-field">

          <label>
            VISIBILITY
          </label>

          <select
            id="grimProductActive"
          >
            <option
              value="true"
              ${
                data.active !== false
                  ? "selected"
                  : ""
              }
            >
              Visible
            </option>

            <option
              value="false"
              ${
                data.active === false
                  ? "selected"
                  : ""
              }
            >
              Hidden
            </option>
          </select>

        </div>

        ${
          data.image
            ? `
              <div
                class="
                  grim-product-preview
                "
              >
                <img
                  src="${escapeHtml(
                    data.image
                  )}"
                  alt=""
                >
              </div>
            `
            : ""
        }

        <div
          class="grim-product-message"
          id="grimProductMessage"
        ></div>

        <div
          class="grim-product-actions"
        >

          <button
            type="submit"
            class="
              grim-product-btn
              primary
            "
          >
            ${
              product
                ? "SAVE CHANGES"
                : "CREATE PRODUCT"
            }
          </button>

          <button
            type="button"
            class="grim-product-btn"
            id="grimCancelProduct"
          >
            CANCEL
          </button>

        </div>

      </form>
    `;

    $("grimProductForm")
      ?.addEventListener(
        "submit",
        saveProduct
      );

    $("grimCancelProduct")
      ?.addEventListener(
        "click",
        () => {
          editingProduct = null;
          area.innerHTML = "";
        }
      );

    area.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  async function saveProduct(
    event
  ) {
    event.preventDefault();

    const message =
      $("grimProductMessage");

    const payload = {
      name:
        safeString(
          $("grimProductName")
            ?.value
        ).trim(),

      type:
        safeString(
          $("grimProductType")
            ?.value
        ).trim(),

      color:
        safeString(
          $("grimProductColor")
            ?.value
        ).trim(),

      price:
        Number(
          $("grimProductPrice")
            ?.value || 0
        ),

      image:
        safeString(
          $("grimProductImage")
            ?.value
        ).trim(),

      active:
        $("grimProductActive")
          ?.value !== "false",

      sort_order:
        Number(
          $("grimProductSort")
            ?.value || 0
        )
    };

    if (!payload.name) {
      if (message) {
        message.textContent =
          "Enter a product name.";

        message.className =
          "grim-product-message error";
      }

      return;
    }

    if (
      !Number.isFinite(
        payload.price
      ) ||
      payload.price < 0
    ) {
      if (message) {
        message.textContent =
          "Enter a valid product price.";

        message.className =
          "grim-product-message error";
      }

      return;
    }
    const imageFile =
  $("grimProductImageFile")
    ?.files?.[0];

if (imageFile) {
  if (!imageFile.type.startsWith("image/")) {
    if (message) {
      message.textContent = "Please choose a valid image.";
      message.className = "grim-product-message error";
    }
    return;
  }

  if (message) {
    message.textContent = "Uploading product image…";
    message.className = "grim-product-message";
  }

  try {
    payload.image = await uploadImage(imageFile);
  } catch (error) {
    console.error("Product image upload failed:", error);

    if (message) {
      message.textContent =
        error?.message || "Product image upload failed.";
      message.className = "grim-product-message error";
    }

    return;
  }
}
    if (message) {
      message.textContent =
        "Saving product…";

      message.className =
        "grim-product-message";
    }

    try {
      if (editingProduct?.id) {
        await api(
          `${PRODUCTS_API}/${encodeURIComponent(
            editingProduct.id
          )}`,
          {
            method: "PUT",
            body: payload
          }
        );
      } else {
        await api(
          PRODUCTS_API,
          {
            method: "POST",
            body: payload
          }
        );
      }

      if (message) {
        message.textContent =
          "Product saved.";

        message.className =
          "grim-product-message success";
      }

      editingProduct = null;

      await loadProducts();

    } catch (error) {
      if (message) {
        message.textContent =
          error?.message ||
          "Unable to save product.";

        message.className =
          "grim-product-message error";
      }
    }
  }

  async function toggleProduct(
    product
  ) {
    if (!product?.id) return;

    try {
      await api(
        `${PRODUCTS_API}/${encodeURIComponent(
          product.id
        )}`,
        {
          method: "PUT",
          body: {
            name:
              product.name || "",

            type:
              product.type || "",

            color:
              product.color || "",

            price:
              Number(
                product.price || 0
              ),

            image:
              product.image || "",

            active:
              product.active === false,

            sort_order:
              Number(
                product.sort_order || 0
              )
          }
        }
      );

      await loadProducts();

    } catch (error) {
      alert(
        error?.message ||
        "Unable to change product visibility."
      );
    }
  }

  async function deleteProduct(
    product
  ) {
    if (!product?.id) return;

    const approved =
      window.confirm(
        `Delete "${
          product.name ||
          "this product"
        }"?`
      );

    if (!approved) return;

    try {
      await api(
        `${PRODUCTS_API}/${encodeURIComponent(
          product.id
        )}`,
        {
          method: "DELETE"
        }
      );

      await loadProducts();

    } catch (error) {
      alert(
        error?.message ||
        "Unable to delete product."
      );
    }
  }

  function findProduct(id) {
    return products.find(
      product =>
        safeString(
          product.id
        ) ===
        safeString(id)
    );
  }

  function bindProductEvents() {
    $("grimAddProduct")
      ?.addEventListener(
        "click",
        () => showForm()
      );

    document
      .querySelectorAll(
        "[data-grim-edit]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const product =
              findProduct(
                button.dataset
                  .grimEdit
              );

            if (product) {
              showForm(product);
            }
          }
        );
      });

    document
      .querySelectorAll(
        "[data-grim-toggle]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const product =
              findProduct(
                button.dataset
                  .grimToggle
              );

            if (product) {
              toggleProduct(
                product
              );
            }
          }
        );
      });

    document
      .querySelectorAll(
        "[data-grim-delete]"
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const product =
              findProduct(
                button.dataset
                  .grimDelete
              );

            if (product) {
              deleteProduct(
                product
              );
            }
          }
        );
      });
  }

  async function loadProducts() {
    try {
      const snapshot =
        await api(
          SNAPSHOT_URL
        );

      products =
        Array.isArray(
          snapshot?.products
        )
          ? snapshot.products
          : [];

      renderProducts();

    } catch (error) {
      console.warn(
        "[GRIM PRODUCT ADDON]",
        error
      );
    }
  }

  function scheduleRefresh() {
    clearTimeout(
      refreshTimer
    );

    refreshTimer =
      setTimeout(
        loadProducts,
        150
      );
  }

  function observeExistingAdmin() {
  const container =
    getContainer();

  if (!container) {
    setTimeout(
      observeExistingAdmin,
      500
    );

    return;
  }

  const observer =
    new MutationObserver(
      () => {
        if (rendering) return;

        const addonStillVisible =
          container.querySelector(
            ".grim-product-addon"
          );

        if (!addonStillVisible) {
          scheduleRefresh();
        }
      }
    );

  observer.observe(
    container,
    {
      childList: true,
      subtree: true
    }
  );
}

  function start() {
    injectStyles();

    observeExistingAdmin();

    loadProducts();
  }

  window.GrimProductManager = {
    refresh:
      loadProducts
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }

})();
