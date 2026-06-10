// The Smart Inbox → Gherkin Lint handoff key: the inbox writes the pasted
// feature here and navigates; the lint page consumes it on mount. (The old
// handoff copied to the clipboard and told the user to paste — it landed on
// an empty page in practice.)
export const GHERKIN_PREFILL_KEY = "sk:gherkin:prefill";
