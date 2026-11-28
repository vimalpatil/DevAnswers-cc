import Tag from "../models/Tag.js";
import { createAppError } from "../utils/createAppError.js";

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 30;

/**
 * Validates and normalizes tag input for question edits (spec 002 §5.3).
 * Accepts a comma-separated string or an array of strings. Trims entries,
 * drops blanks, de-dupes case-insensitively (keeping the first spelling),
 * and enforces 1–5 tags of at most 30 characters each.
 * Throws a 400 AppError on any rule violation.
 */
export const parseTagNames = (input) => {
  let raw;
  if (typeof input === "string") {
    raw = input.split(",");
  } else if (Array.isArray(input) && input.every((t) => typeof t === "string")) {
    raw = input;
  } else {
    throw createAppError(
      "Tags must be a comma-separated string or an array of strings",
      400,
    );
  }

  const seen = new Set();
  const names = [];
  for (const entry of raw) {
    const name = entry.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  if (names.length < 1 || names.length > MAX_TAGS) {
    throw createAppError(`Provide between 1 and ${MAX_TAGS} tags`, 400);
  }

  if (names.some((name) => name.length > MAX_TAG_LENGTH)) {
    throw createAppError(
      `Each tag must be at most ${MAX_TAG_LENGTH} characters`,
      400,
    );
  }

  return names;
};

/**
 * Finds or creates tags by exact name and returns their IDs in input order.
 */
export const resolveTagIds = async (names) =>
  Promise.all(
    names.map(async (name) => {
      const existingTag = await Tag.findOne({ name });
      if (existingTag) return existingTag._id;

      const newTag = new Tag({ name });
      await newTag.save();
      return newTag._id;
    }),
  );
