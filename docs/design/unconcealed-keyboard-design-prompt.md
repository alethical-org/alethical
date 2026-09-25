## Prompt

Update the Unconcealed email designs so they match the build decisions, and draw the keyboard states that have not yet been shown. The aim is to make mouse clicks feel clean while keyboard users can always see which control they are using. Keep the existing visual direction.

This covers the Unconcealed invitation on /money, the invitation-origin sign-in and account-creation messages, subscription confirmation and success, /email-preferences, and /unsubscribe. It does not open a redesign of the account menu or unrelated site controls.

New drawings needed: keyboard interaction
Draw the actual visible treatment, not just a written “keyboard focus” note. You own its appearance. Show each distinct control type on light and dark backgrounds, including:
- Both email-preference checkbox rows and the optional features checkbox in subscription confirmation: unchecked, checked, changed but not saved, and save not confirmed. Show keyboard focus with each relevant state.
- Email action buttons and links: ready, keyboard focus, hover, keyboard focus plus hover, pressed, saving, retry, and success where applicable.
- Disabled and busy controls, including a button that keeps keyboard focus while saving. Make its unavailable state clear.
- Close controls, entry into a dialog, focus moving to the success heading, and focus returning when a dialog closes. A heading receiving focus for a screen reader does not need to look like a selected button.
- A short sequence showing Tab arriving at a checkbox, Space changing its checkmark while the focus marker remains, and Tab moving the marker to the next control.
- Matching mouse-click and touch examples showing the checkmark change without the keyboard-only outline.

Include every distinct applicable state, but do not invent impossible combinations. Keep focus clear, with enough contrast and space that no edge is cropped. Support wrapped text, enlarged text, and layouts below 768px, from 768px to 1099px, and from 1100px. Pick useful drawing sizes within those constraints. Keyboard access also matters on a narrow screen.

Pointer behavior already decided
Remove the keyboard-only purple outline triggered by a mouse click or touch on the email checkbox rows and email action buttons. Keep their approved hover, pressed and checked feedback. Keyboard navigation must retain a visible focus marker; the build keeps the current keyboard treatment until the new drawings are reviewed. Text-entry fields still show focus when clicked for typing.

This is NOT a ban on purple outlines. Eugene explicitly keeps the drawn purple outline on the campaign-money contribution expand/collapse arrow, including its intended mouse behavior. Preserve that exception. Do not copy the arrow treatment onto email rows or call an outline “selected” merely because the row is open.

Full remaining build list to reflect
1. Sign-in helper, when entered from Unconcealed:
“Sign in or create an account to get Unconcealed research by email”
This changes the helper sentence, not its title or buttons.
2. Keep “Save email preferences” at the same responsive width, height and position when its label becomes “Saving…” or “Try again”, then returns. Reserve room for the longest supported label. Keep the full-width phone button. Block repeated saves while busy.
3. Reserve space for “✓ Your email preferences are saved” before it appears. Keep the approved position beside the button where it fits and below on narrow screens. A successful save must not push the button, nearby content or footer. Show success only after confirmation from the server. Longer errors may wrap and grow.
4. Apply that steady-size requirement to other changing email buttons, including subscribing and unsubscribing. No artificial delay or resizing animation to disguise a jump.
5. The build will investigate the reported brief purple-outlined element during Subscribe → Saving → success. Draw the intended transition with stable content and appropriate keyboard/screen-reader focus. Do not claim a specific cause from the screenshot. Keep progress words and the success announcement.
6. Show click-outline behavior consistently across the /money invitation and Email preferences button, subscription choices/actions/success buttons, /email-preferences choices/save/reload/retry, and /unsubscribe actions/retry.

Other settled details to retain
- /money invitation button: “Get Unconcealed by email”.
- /money signed-out helper: “Create an account or sign in”. Do not repeat “free” here.
- Account-creation helper: “Create your free account, then subscribe to Unconcealed”.
- Delivery uses the account email, shown read-only. Do not suggest choosing another delivery address.
- Confirmation button: “Subscribe to Unconcealed”.
- Preferences: “Unconcealed research” with “About Minnesota campaign money and lobbying”; “New features and services” needs no redundant helper.
- Preserve “Not saved yet” and “Not confirmed” beside changed choices.
- Preserve the existing saved features choice; a never-chosen optional features checkbox starts unchecked.
- Keep the public reports readable without an account. Do not introduce a publishing schedule.
- The green wash around the sign-in helper was explicitly a review annotation, not a shipped background. Preserve comfortable padding in annotations and distinguish them from product styling.
- Keep the white research article card below the dark invitation. Retain the approved whole-card hover and reduced-motion behavior, without inventing a new button-hover treatment.

Update your saved project rules
Save these decisions in the project instructions used for future drawings, reviews and build notes:
- Name each control, its state and what triggers it. Rest, hover, pointer press, checked/selected state, keyboard focus, saving, success and failure are separate.
- Never decide whether an outline belongs by its colour alone. Preserve explicit exceptions at the scope approved.
- Draw missing interaction states; a resting drawing does not prove that focus or feedback should be absent.
- Clearly label review-only highlights so they cannot be mistaken for product styling.
- Check padding, spacing, wrapping, readable contrast, control labels and narrow-screen use while preserving the approved visual direction.
- Buttons and predictable confirmation messages must not make the layout jump between states. Errors must stay readable, with a recovery action.
- Draw hover for each applicable button type, including icon buttons, while keeping keyboard and touch use clear. Busy or disabled controls must not imply that another action is available.
- Print the settled wording exactly. Offer alternative wording separately with a reason.
- Keep drawings and written behavior aligned. Surface conflicts explicitly rather than silently choosing one.
- Distinguish drawn intent from behavior actually tested in a browser.
- Settled corrections can proceed in the build without another drawing. A genuinely unresolved visual choice waits for its drawing and review.

Update the affected drawings and build notes to reflect these settled corrections. Do not generate or provide a downloadable handoff when finished; implementation of the settled corrections is underway and does not depend on another handoff. Show the NEW keyboard-state drawings in this Design project for review; their new appearance will not be built before that review. Briefly confirm which drawings, build notes and saved rules you updated, and name anything still unresolved.
