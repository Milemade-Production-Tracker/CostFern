# CostFern UI proposal

Open [the interactive preview](http://127.0.0.1:8765/) while the local preview server is running. You can also open `index.html` in a browser with this folder intact. To restart the preview from the CostFern application directory, run:

```powershell
.\node_modules\.bin\vite.cmd design-preview --host 127.0.0.1 --port 8765 --strictPort
```

The preview opens on the November cost review. Start in **Review Queue**, load the two sample CSVs, and choose **Import and compare**. Match Label A, approve Fern and Tray, and enter reasons for the five exclusions. Finalize to download the approved lines. **View completed sample** opens the preserved result directly. Use **History** to compare the supplier’s v1 and v2, and use **Plan** to compare the three tiers and simulate switching. **Demo** lets you try the last slot or a full allowance, then restore the sample.

The five screens share a warm canvas, an evergreen workspace rail, compact controls, and status colors that distinguish approvals from exceptions. The desktop review keeps old cost, proposed cost and change side by side. On a narrow screen, each row becomes a card. The source filenames, line numbers and matching candidates stay in the detail panel.

The control patterns are adapted from Uiverse’s [segmented radio](https://uiverse.io/Yaya12085/rude-mouse-79), [dashed file chooser](https://uiverse.io/Yaya12085/tender-moose-95), and [compact search](https://uiverse.io/Galahhad/breezy-wolverine-23/). The HTML, CSS and interactions are implemented in this folder.

The quote values, SKUs, source files and finalized decisions come from CostFern’s Shopify development-store QA fixtures. Preview changes are local to the browser. The sample image is an illustration of those product types, generated with the built-in image tool and saved at `assets/supplier-catalog.png`.

Image prompt

> Use case: product-mockup. Create ONE photorealistic editorial commerce photograph to serve as the hero and source of crop thumbnails for a Shopify supplier cost-review UI. Wide 3:2 photograph with a genuine natural product-catalog look. An unbranded premium home-and-garden tabletop: a lush small button fern in a ribbed terracotta pot on the left third, a muted moss-green oval ceramic drip tray on the lower center-right, and a stack of ivory unprinted plant labels tucked towards the far right. Exactly three types of products, clearly distinct with good separation. A warm soft pale limestone surface and muted sage-green stucco wall, sophisticated North American homeware catalog, soft natural sidelight and authentic ceramic texture, restrained warm charcoal and moss color palette. Attractive dark leaves, soft shadows and editorial crop, full pot, tray and labels visible. No lettering, no graphic marks, no UI, no humans, no packaging or distracting props. Photography only.
