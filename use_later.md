# Hidden / Saved-for-Later Snippets

Content removed from the live site but kept here so it can be restored later.

---

## Blog navigation links (hidden on request)

The blog itself still exists as separate pages (`blog.html`, `blog-post.html`)
and the `/blog` route in `server.js`. Only the links to it were removed from
`index.html`. To bring the Blog back, re-add these links.

### 1. Desktop nav — inside `<nav class="nav-links">` (was between "About" and "Gallery")

```html
<a href="/blog">Blog</a>
```

### 2. Mobile drawer — inside `<aside class="nav-drawer"> <nav>` (was between "About" and "Gallery")

```html
<a href="/blog">Blog</a>
```

### 3. Footer links list — inside the footer "Quick Links" `<ul>` (was between "Featured Products" and "Gallery")

```html
<li><a href="/blog">Blog</a></li>
```

_Removed on: hide-blog request._

---

## Promotional banners section (removed on request)

Two promo cards ("Toy Season Offers" and "Back to School — Bags, Bottles &
Stationery"). This sat between the "Featured Collections / Gallery" section and
the "Testimonials / Google Reviews" section in `index.html`. The left card image
is admin-editable via the `promo_left` slot.

```html
<!-- =============================================
     SECTION 7 — PROMOTIONAL BANNERS
============================================= -->
<section class="promo" aria-label="Current promotions">
  <div class="container">
    <div class="promo-inner">
      <div class="promo-card dark reveal-left">
        <img data-slot="promo_left" src="image assets/imgi_199_Toy_car_rc_car.jpg" alt="Remote control toys offer" loading="lazy" decoding="async" />
        <div class="promo-card-overlay">
          <div class="promo-eyebrow">This Month</div>
          <div class="promo-title">Toy Season Offers</div>
          <div class="promo-subtitle">Special in-store pricing across ride-ons, RC toys and play sets.</div>
          <a href="#contact" class="btn btn-primary btn-sm">Ask What's On Offer</a>
        </div>
      </div>
      <div class="promo-card brand reveal-right">
        <span class="promo-deco" aria-hidden="true"></span>
        <div class="promo-card-overlay">
          <div class="promo-eyebrow">Back to School</div>
          <div class="promo-title">Bags, Bottles &amp; Stationery Ready</div>
          <div class="promo-subtitle">Full range in stock ahead of the new term. Bundle pricing available in store.</div>
          <a href="#contact" class="btn btn-dark btn-sm">Plan Your List</a>
        </div>
      </div>
    </div>
  </div>
</section>
```

_Removed on: remove-promo-banner request._

---

## Featured Collections — "Back to School" full-span banner card (removed on request)

The bottom full-width card inside the Featured Collections / Gallery section
(`#gallery`), showing "Bags, Bottles & Stationery — All Sizes In Stock" over a
strollers image. Image is admin-editable via the `collection_banner` slot. It
was the last `.coll-card` inside `<div class="collections-grid">`.

```html
<!-- Bottom full-span card -->
<div class="coll-card reveal" style="grid-column:1/-1;height:200px;transition-delay:.25s">
  <img data-slot="collection_banner" src="image assets/imgi_2_b1-400.jpg" alt="School bags, bottles and back-to-school essentials" loading="lazy" decoding="async" />
  <div class="coll-overlay" style="background:linear-gradient(to right, rgba(31,37,48,.86) 32%, rgba(31,37,48,.15) 72%);flex-direction:row;align-items:center;justify-content:space-between;gap:20px;">
    <div>
      <div class="coll-tag">Back to School</div>
      <div class="coll-title" style="font-size:1.4rem;margin-bottom:0;">Bags, Bottles &amp; Stationery — All Sizes In Stock</div>
    </div>
    <a href="#contact" class="coll-link" style="flex-shrink:0;">Check Availability ›</a>
  </div>
</div>
```

_Removed on: remove-banner request._
