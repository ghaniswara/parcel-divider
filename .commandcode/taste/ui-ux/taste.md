# UI/UX

- When the user asks for "web components", they mean real per-component CSS isolation via Shadow DOM — not light-DOM custom elements sharing a global stylesheet. They pushed back when the gui v2 rewrite used light-DOM custom elements with a shared pee.css. Confidence: 0.9

- When editing one input control, never auto-adjust or auto-recalculate the other controls' values — leave sibling inputs untouched while typing. Confidence: 0.9
- Don't clamp or normalize user-entered values to conventional bounds; users should be able to enter values beyond the "obvious" range (e.g., target % over 100%). Confidence: 0.85
