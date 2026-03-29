# Medium Widget Category Legend

## Goal

Use the extra vertical space in the iPhone `systemMedium` widget to show a single compact category legend row beneath the heatmap, while keeping the heatmap readable and visually balanced.

## Approved Direction

- Replace the medium widget footer badges with a one-line category legend.
- Keep the footer focused on categories only; omit sync and device badges.
- Tighten medium widget vertical spacing and heatmap gaps enough to fit the legend without making the heatmap feel cramped.
- Use existing `DayWrappedRendering.legendCategories(...)` ordering so the legend reflects the most relevant categories.
- Seed the simulator/debug widget with `DayWrappedRendering.sampleSnapshot()` when launched with `--demo-layout`, and reload widget timelines so the home-screen widget shows realistic activity during review.

## Notes

- The widget-specific header keeps its explicit long-date format.
- The category legend should stay compact and single-line on `systemMedium`.
- Debug/demo data is scoped to debug/simulator workflows and should not affect production behavior.
