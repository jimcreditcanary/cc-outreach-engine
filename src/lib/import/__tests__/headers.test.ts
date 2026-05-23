import { describe, it, expect } from "vitest";
import { normalizeHeader, stripEntityPrefix, buildHeaderIndex } from "../headers";
import { mapDeal, mapNote, resolveStatus } from "../mappers";

describe("normalizeHeader", () => {
  // Real columns from a Pipedrive deal export.
  it.each([
    ["Deal - Title", "title"],
    ["Deal - Label", "label"],
    ["Deal - Stage", "stage"],
    ["Organization - Won deals", "won_deals"],
    ["Deal - Expected close date", "expected_close_date"],
    ["Deal - Value", "value"],
    ["Deal - Deal created", "deal_created"],
    ["Deal - Lost reason", "lost_reason"],
    ["Deal - Organization", "organization"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeHeader(input)).toBe(expected);
  });

  it("handles UK/US spelling and stray whitespace", () => {
    expect(normalizeHeader("Organisation -  Name ")).toBe("name");
    expect(normalizeHeader("Person - LinkedIn URL")).toBe("linkedin_url");
  });
});

describe("stripEntityPrefix", () => {
  it("only strips a leading entity prefix, not mid-string dashes", () => {
    expect(stripEntityPrefix("Deal - Re-engagement plan")).toBe("Re-engagement plan");
  });
});

describe("buildHeaderIndex", () => {
  it("maps normalised → original headers", () => {
    const ix = buildHeaderIndex(["Deal - Title", "Deal - Organization"]);
    expect(ix.get("title")).toBe("Deal - Title");
    expect(ix.get("organization")).toBe("Deal - Organization");
  });
});

describe("mapDeal against a real export row", () => {
  it("maps the observed Pipedrive shape", () => {
    const row = {
      "Deal - Title": "Snugg - Broker Route",
      "Deal - Label": "Broker",
      "Deal - Stage": "Qualify / Discovery",
      "Organization - Won deals": "0",
      "Deal - Expected close date": "2026-04-30",
      "Deal - Value": "25000",
      "Deal - Deal created": "2026-01-30 15:55:37",
      "Deal - Lost reason": "",
      "Deal - Organization": "Snugg",
    };
    const deal = mapDeal(row);
    expect(deal).not.toBeNull();
    expect(deal!.title).toBe("Snugg - Broker Route");
    expect(deal!.organisation_name).toBe("Snugg");
    expect(deal!.stage).toBe("Qualify / Discovery");
    expect(deal!.value).toBe(25000);
    expect(deal!.status).toBe("open"); // no lost reason → open
    expect(deal!.proposal_exists).toBe(false);
  });

  it("strips currency formatting from value", () => {
    const deal = mapDeal({ "Deal - Title": "X", "Deal - Value": "£1,250.50" });
    expect(deal!.value).toBe(1250.5);
  });

  it("returns null for an empty row", () => {
    expect(mapDeal({ "Deal - Label": "Broker" })).toBeNull();
  });
});

describe("mapNote", () => {
  it("maps a Pipedrive note export row, linking by names", () => {
    const note = mapNote({
      "Note - ID": "9001",
      "Note - Content": "Spoke to FD — budget signed off for Q3, wants CoP demo.",
      "Note - Organization": "Snugg",
      "Note - Deal": "Snugg - Broker Route",
      "Note - Person": "Jane Doe",
      "Note - User": "Jim Fell",
      "Note - Add time": "2026-02-10 14:00:00",
    });
    expect(note).not.toBeNull();
    expect(note!.content).toContain("budget signed off");
    expect(note!.organisation_name).toBe("Snugg");
    expect(note!.deal_title).toBe("Snugg - Broker Route");
    expect(note!.contact_name).toBe("Jane Doe");
    expect(note!.author).toBe("Jim Fell");
    expect(note!.noted_at).toBe("2026-02-10 14:00:00");
    expect(note!.pipedrive_note_id).toBe(9001);
  });

  it("returns null when there is no content", () => {
    expect(mapNote({ "Note - Organization": "Snugg" })).toBeNull();
  });
});

describe("resolveStatus", () => {
  it("derives lost from a lost reason when status is absent", () => {
    expect(resolveStatus(undefined, "Price")).toBe("lost");
  });
  it("defaults to open", () => {
    expect(resolveStatus(undefined, undefined)).toBe("open");
  });
  it("honours an explicit status, never infers won", () => {
    expect(resolveStatus("Won", undefined)).toBe("won");
    expect(resolveStatus("Open", "ignored")).toBe("open");
  });
});
