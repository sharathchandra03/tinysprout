Brand logos for the homepage "Brands You'll Find Here" marquee.
================================================================

HOW IT WORKS
------------
The marquee is data-driven from the BRANDS array in index.html (search for
"var BRANDS"). Each brand has a `logo` path that points into this folder.

For each brand the marquee shows EITHER:
  1. the real logo image, if a file exists at that path and loads, OR
  2. a clean typographic fallback (the brand name in the site font).

Right now there are NO logo image files here, so every brand shows the
polished text fallback. That is intentional and looks production-ready.

TO ADD A REAL LOGO
------------------
Drop the brand's official logo into this folder using the exact filename the
BRANDS array expects (SVG preferred; transparent PNG/WebP also fine), e.g.:

    sebamed.svg   (or sebamed.png / sebamed.webp — then update that one path)
    chicco.svg
    lego.svg
    ...

That brand will automatically switch from the text fallback to the image,
with no code changes. Logos are constrained with object-fit: contain
(max 110 x 48), so different logo proportions won't distort.

Expected filenames (match the BRANDS array in index.html):
    sebamed, cetaphil, chicco, cello, milton, doms, mattel, funskool,
    jockey, ramraj, sukaniya, kothari-creations, otto, mee-mee, krakki,
    bodycare, ollypop, lego, monopoly

NOTE: Use each brand's genuine official logo (from its press/media kit or
your supplier assets). Do not use product photos, screenshots or marketplace
images.
