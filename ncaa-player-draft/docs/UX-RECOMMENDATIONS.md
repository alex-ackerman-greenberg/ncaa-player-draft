# UI/UX improvement recommendations

Suggestions to clean up the UI and improve the experience of the March Madness Player Draft app. Ordered by impact and effort.

---

## High impact, lower effort

### 1. **Replace `prompt()` for editing entry names**
**Current:** Clicking the ✎ (edit) button opens a browser `prompt()`.  
**Improvement:** Use an inline edit (click name → input appears, Enter to save, Escape to cancel) or a small modal. Improves feel and works better on mobile.

### 2. **Consistent page titles and “you are here”**
**Current:** Each view has an h2, but the nav doesn’t always make the current section obvious on first scan.  
**Improvement:** Ensure the active nav item is clearly highlighted (you already have `.nav a.active`; consider a bottom border or pill style). Optionally set `<title>` or a visible “Page name” when the hash changes so bookmarks and history are clear.

### 3. **Loading and button states**
**Current:** Buttons like “Load top scorers” and “Refresh scores now” don’t disable during the request; users may double-click.  
**Improvement:** Disable the button and show “Loading…” (or a spinner) for the duration of the request. Re-enable and show “Loaded” or “Updated” (or an error) when done.

### 4. **Clearer success/error feedback**
**Current:** Status text appears in small copy (e.g. `#refresh-status`, `#pool-tournament-status`).  
**Improvement:** Keep status in the same place but style success (e.g. green) and error (e.g. red) distinctly. Optionally auto-clear success after a few seconds and keep errors until dismissed or retry.

### 5. **Bracket view: scroll / width**
**Current:** Bracket shell can overflow on small screens.  
**Improvement:** You have `overflow-x: auto` on `.bracket-espn`; add a short hint when the bracket is visible (e.g. “Scroll horizontally to see all regions”) so users know they can scroll.

---

## Medium impact, medium effort

### 6. **Mobile nav**
**Current:** Nav is a horizontal row of links; on narrow screens it can wrap or feel cramped.  
**Improvement:** Consider a compact nav: e.g. a “Menu” button that toggles the links, or a bottom tab bar for Leaderboard / Teams / Pool / Bracket so thumb reach is better.

### 7. **Empty states**
**Current:** Leaderboard always shows 7 rows; rosters show “No players assigned”; pool shows “Click Load top scorers…”.  
**Improvement:** Use one pattern for “nothing here yet”: icon or illustration + one line of explanation + one clear CTA (e.g. “Load player pool” → links to #pool and highlights “Load top scorers”). Apply the same pattern to rosters and pool.

### 8. **Pool: search/filter**
**Current:** Pool is a long list sorted by PPG.  
**Improvement:** Add a search/filter by name or team so users can find players quickly without scrolling. A simple text input that filters the list is enough.

### 9. **Rosters: “Add player” UX**
**Current:** Each entry has a dropdown “Add player” with every unassigned player.  
**Improvement:** Keep the dropdown but add a secondary action like “Choose from pool” that scrolls to or opens the pool view (or a small modal of pool players) so users can add from context.

### 10. **Focus and keyboard**
**Current:** Buttons and links are focusable; focus style may be minimal.  
**Improvement:** Add a visible `:focus-visible` style (e.g. outline or ring) so keyboard users can see where they are. Ensure “Refresh scores now”, “Load top scorers”, and form submit are all reachable and activatable by keyboard.

---

## Polish and consistency

### 11. **Card and section consistency**
**Current:** Some sections use `.card` (e.g. pool load, manual entry); others are plain (leaderboard, bracket header).  
**Improvement:** Use one pattern for “section blocks”: e.g. all major sections in a view use the same card style (padding, border, radius) so the page feels consistent.

### 12. **Button hierarchy**
**Current:** `.btn-primary` (accent) and `.btn-secondary` (outline).  
**Improvement:** Reserve primary for the single main action per block (e.g. “Load top scorers”); use secondary for “Load tournament field only”, “Refresh PPG data”, “Refresh bracket”. Ensure “Refresh scores now” on the leaderboard is clearly primary there.

### 13. **Links at bottom of views**
**Current:** Several views end with “Leaderboard · Teams · Pool” (or similar).  
**Improvement:** Keep these for cross-navigation; optionally style them as subtle secondary links (e.g. “Back to Leaderboard”) so they don’t compete with the main content.

### 14. **Bracket shell note**
**Current:** “Field announced Selection Sunday. Bracket will fill when the tournament is released.”  
**Improvement:** If the bracket is the main “pre-tournament” view, consider moving this note into a small info callout (icon + text) so it’s visible but not dominant.

---

## Optional enhancements

- **Last updated:** Show “Scores updated 2 min ago” (or “Updating…”) next to the leaderboard refresh button using the last refresh time.
- **Confirm before replace pool:** “Load top scorers” replaces the entire pool; add a short confirm (“This will replace all players in the pool. Continue?”) to avoid accidental wipe.
- **Roster size hint:** Show “3/∞” or “3 players” per entry so users see roster size at a glance.
- **Print/export:** Print-friendly CSS or a “Print leaderboard” button so the standings can be printed or saved as PDF.

---

## Quick wins (minimal code)

1. Add `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` (or similar) for interactive elements.
2. Disable “Refresh scores now” and “Load top scorers” (etc.) in the click handler until the request completes.
3. Add `aria-current="page"` to the active nav link (in addition to `.active`).
4. Set `document.title` in the `route()` function when the hash changes (e.g. “Leaderboard – March Madness Draft”).
5. Add a `.card` (or same section style) wrapper to the leaderboard standings block so it matches the pool/roster card style.

If you tell me which area you want to tackle first (e.g. “edit name without prompt” or “loading states”), I can outline or implement the exact code changes next.
