import { describe, it, expect } from "vitest";
import { lintGherkin, analyzeCoverage } from "@/lib/gherkinLint";

const conformant = `Feature: Checkout
  As a shopper I want to pay so that I own the items.

  @valid @smoke
  Scenario: Pay for a cart
    Given a Cart [c1] with items
    When the shopper pays
    Then the order is confirmed
`;

describe("lintGherkin", () => {
  it("passes a conformant single scenario with no errors", () => {
    const r = lintGherkin(conformant);
    expect(r.ok).toBe(true);
    expect(r.summary.errors).toBe(0);
    expect(r.summary.scenarios).toBe(1);
  });

  it("errors when a scenario has more than one When (one event per scenario)", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid @smoke
  Scenario: Two events
    Given a Thing [t1]
    When the user submits
    When the user submits again
    Then it is done
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === "ERROR" && /one event/.test(i.message))).toBe(true);
  });

  it("errors when a scenario has no tags", () => {
    const r = lintGherkin(`Feature: F
  desc

  Scenario: Untagged
    Given a Thing [t1]
    When the user submits
    Then it is done
`);
    expect(r.issues.some((i) => i.severity === "ERROR" && /no tags/.test(i.message))).toBe(true);
  });

  it("errors when tags are present but no intent tag, and @valid clears it", () => {
    const noIntent = lintGherkin(`Feature: F
  desc

  @smoke
  Scenario: No intent
    Given a Thing [t1]
    When the user submits
    Then it is done
`);
    expect(noIntent.issues.some((i) => i.severity === "ERROR" && /intent tag/.test(i.message))).toBe(true);

    const withIntent = lintGherkin(`Feature: F
  desc

  @valid @smoke
  Scenario: Has intent
    Given a Thing [t1]
    When the user submits
    Then it is done
`);
    expect(withIntent.issues.some((i) => /intent tag/.test(i.message))).toBe(false);
  });

  it("warns on implementation leakage (a UI click)", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid @smoke
  Scenario: Leaky
    Given a Thing [t1]
    When the user clicks the button
    Then it is done
`);
    expect(r.issues.some((i) => i.severity === "WARN" && /leakage/i.test(i.message))).toBe(true);
  });

  it("warns when an entity is referenced before its typed first-use", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid @smoke
  Scenario: Undeclared entity
    Given the order references [ghost]
    When the user submits
    Then it is done
`);
    expect(r.issues.some((i) => /referenced before a typed first-use/.test(i.message))).toBe(true);
  });
});

describe("analyzeCoverage", () => {
  it("flags a happy-path-only feature as missing negative paths", () => {
    const c = analyzeCoverage(`Feature: F
  @valid @smoke
  Scenario: A
    When x
    Then y
`);
    expect(c.gaps.some((g) => /No negative paths/.test(g))).toBe(true);
  });

  it("does not flag negative-paths once an @invalid case exists", () => {
    const c = analyzeCoverage(`Feature: F
  @valid @smoke
  Scenario: A
    When x
    Then y
  @invalid @smoke
  Scenario: B
    When bad x
    Then error
`);
    expect(c.intents.invalid).toBe(1);
    expect(c.gaps.some((g) => /No negative paths/.test(g))).toBe(false);
  });

  it("treats @security as a negative path too (no gap)", () => {
    const c = analyzeCoverage(`Feature: F
  @security @smoke
  Scenario: A
    When attacker x
    Then blocked
`);
    expect(c.gaps.some((g) => /No negative paths/.test(g))).toBe(false);
  });

  it("counts scenarios with no Then as missing an assertion", () => {
    const c = analyzeCoverage(`Feature: F
  @valid @smoke
  Scenario: No assertion
    Given a Thing [t1]
    When x
`);
    expect(c.noAssertion).toBe(1);
    expect(c.gaps.some((g) => /no .Then/.test(g))).toBe(true);
  });

  it("returns an empty coverage for an empty feature", () => {
    const c = analyzeCoverage("");
    expect(c.scenarios).toBe(0);
    expect(c.gaps).toEqual([]);
  });
});

describe("lintGherkin — more gate rules", () => {
  it("ERRORs when there is no Feature: declaration", () => {
    const r = lintGherkin(`@valid @smoke
Scenario: Orphan
  Given a Thing [t1]
  When x
  Then y
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === "ERROR" && /No .Feature:./.test(i.message))).toBe(true);
  });

  it("WARNs on a Given duplicated across scenarios (move to Background)", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid @smoke
  Scenario: A
    Given a shared precondition
    When x
    Then y

  @valid @smoke
  Scenario: B
    Given a shared precondition
    When z
    Then w
`);
    expect(r.issues.some((i) => /move to Background/.test(i.message))).toBe(true);
  });

  it("WARNs when a scenario has an intent tag but no suite tag", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid
  Scenario: No suite
    Given a Thing [t1]
    When x
    Then y
`);
    expect(r.issues.some((i) => i.severity === "WARN" && /suite tag/.test(i.message))).toBe(true);
  });

  it("WARNs on a non-standard tag", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid @smoke @bogustag
  Scenario: Weird tag
    Given a Thing [t1]
    When x
    Then y
`);
    expect(r.issues.some((i) => i.severity === "WARN" && /non-standard tag/.test(i.message))).toBe(true);
  });

  it("WARNs on a non-click implementation leak (raw SQL)", () => {
    const r = lintGherkin(`Feature: F
  desc

  @valid @smoke
  Scenario: SQL leak
    Given a Thing [t1]
    When the system runs SELECT * from orders
    Then it is done
`);
    expect(r.issues.some((i) => /raw SQL/.test(i.message))).toBe(true);
  });
});
