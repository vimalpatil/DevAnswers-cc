import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parseTagNames,
  resolveTagIds,
} from "../../../src/services/tagHelper.js";
import Tag from "../../../src/models/Tag.js";

vi.mock("../../../src/models/Tag.js");

describe("tagHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseTagNames", () => {
    it("accepts a comma-separated string and an array with the same result", () => {
      expect(parseTagNames("react, node")).toEqual(["react", "node"]);
      expect(parseTagNames(["react", "node"])).toEqual(["react", "node"]);
    });

    it("trims each tag", () => {
      expect(parseTagNames("  react  ,\tnode ")).toEqual(["react", "node"]);
      expect(parseTagNames([" react "])).toEqual(["react"]);
    });

    it("drops blank entries", () => {
      expect(parseTagNames("react, , node,")).toEqual(["react", "node"]);
      expect(parseTagNames(["", "react", "  "])).toEqual(["react"]);
    });

    it.each([[""], [" , "], [[]], [["", "  "]]])(
      "throws 400 when no tags remain (%j)",
      (input) => {
        expect(() => parseTagNames(input)).toThrow(
          expect.objectContaining({
            message: "Provide between 1 and 5 tags",
            statusCode: 400,
          }),
        );
      },
    );

    it("de-dupes case-insensitively, keeping the first spelling", () => {
      expect(parseTagNames("React, react, REACT, node")).toEqual([
        "React",
        "node",
      ]);
    });

    it("allows 5 tags and rejects 6", () => {
      expect(parseTagNames("a, b, c, d, e")).toHaveLength(5);
      expect(() => parseTagNames("a, b, c, d, e, f")).toThrow(
        expect.objectContaining({
          message: "Provide between 1 and 5 tags",
          statusCode: 400,
        }),
      );
    });

    it("counts tags after de-duping", () => {
      expect(parseTagNames("a, b, c, d, e, A")).toHaveLength(5);
    });

    it("allows 30 characters and rejects 31", () => {
      expect(parseTagNames("x".repeat(30))).toEqual(["x".repeat(30)]);
      expect(() => parseTagNames("x".repeat(31))).toThrow(
        expect.objectContaining({
          message: "Each tag must be at most 30 characters",
          statusCode: 400,
        }),
      );
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 5],
      ["an object", { $ne: "" }],
      ["an array with a non-string", ["react", 3]],
    ])("throws 400 for %s", (_label, input) => {
      expect(() => parseTagNames(input)).toThrow(
        expect.objectContaining({
          message:
            "Tags must be a comma-separated string or an array of strings",
          statusCode: 400,
        }),
      );
    });
  });

  describe("resolveTagIds", () => {
    it("returns an existing tag's ID without saving", async () => {
      Tag.findOne = vi.fn().mockResolvedValue({ _id: "tag-react" });

      const ids = await resolveTagIds(["react"]);

      expect(Tag.findOne).toHaveBeenCalledWith({ name: "react" });
      expect(Tag).not.toHaveBeenCalled();
      expect(ids).toEqual(["tag-react"]);
    });

    it("creates missing tags and keeps the input order", async () => {
      const save = vi.fn().mockResolvedValue(true);
      Tag.findOne = vi.fn(async ({ name }) =>
        name === "react" ? { _id: "tag-react" } : null,
      );
      Tag.mockImplementation(function ({ name }) {
        return { _id: `new-${name}`, save };
      });

      const ids = await resolveTagIds(["vitest", "react", "msw"]);

      expect(ids).toEqual(["new-vitest", "tag-react", "new-msw"]);
      expect(save).toHaveBeenCalledTimes(2);
    });
  });
});
