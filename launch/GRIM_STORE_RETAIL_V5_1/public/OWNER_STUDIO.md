# GRIM Owner Studio

Open `/admin.html` after deployment.

Required production environment variables:
- `ADMIN_PASSWORD`: long private password for the owner dashboard.
- `SESSION_SECRET`: long random secret.
- `DATA_DIR`: path to a persistent hosting disk/volume. This stores `grim.db` and uploaded product images.

The dashboard can:
- Add products and upload a product image.
- Change product name/colorway, category, price, image and display order.
- Hide products without deleting order history.
- View recent orders.

Feature/layout changes still belong in the GitHub repository and should be deployed through the hosting provider's Git integration.
