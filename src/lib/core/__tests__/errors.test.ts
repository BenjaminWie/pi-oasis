import { describe, it, expect } from "vitest";
import { AppError, handleServerError, success, fail } from "../errors";

describe("core/errors", () => {
  it("handleServerError should return success for successful promise", async () => {
    const result = await handleServerError(async () => "ok");
    expect(result).toEqual(success("ok"));
  });

  it("handleServerError should return fail for AppError", async () => {
    const result = await handleServerError(async () => {
      throw new AppError("bad request", 400, "ERR_BAD");
    });
    expect(result).toEqual(fail("bad request", 400, "ERR_BAD"));
  });

  it("handleServerError should return 500 for generic error", async () => {
    const result = await handleServerError(async () => {
      throw new Error("boom");
    });
    expect(result).toEqual(fail("boom", 500));
  });
});
