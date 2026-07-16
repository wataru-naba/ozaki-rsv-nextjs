import { describe, expect, it } from "vitest";
import {
  ADMIN_HOME_PATH,
  LOGIN_PATH,
  isProtectedAdminPath,
  resolveAdminRedirect,
} from "@/lib/auth/middleware-logic";

const ORIGIN = "https://example.com";

/**
 * US-005 受入条件(認可 / ルート保護): middleware の判定ロジック。
 *
 * middleware 本体は Edge の NextAuth ラッパーで包まれ直接呼びづらいため、
 * 判定を純粋関数 isProtectedAdminPath / resolveAdminRedirect に抽出して検証する。
 */

describe("isProtectedAdminPath", () => {
  it("/admin 配下は保護対象", () => {
    expect(isProtectedAdminPath("/admin")).toBe(true);
    expect(isProtectedAdminPath("/admin/")).toBe(true);
    expect(isProtectedAdminPath("/admin/reservations")).toBe(true);
    expect(isProtectedAdminPath("/admin/login")).toBe(true);
  });

  it("公開ルートは保護対象外", () => {
    expect(isProtectedAdminPath("/")).toBe(false);
    expect(isProtectedAdminPath("/reserve")).toBe(false);
    expect(isProtectedAdminPath("/reserve/step/1")).toBe(false);
    expect(isProtectedAdminPath("/api/public/reservations")).toBe(false);
    expect(isProtectedAdminPath("/api/auth/callback")).toBe(false);
  });

  it("/administrator のような前方一致の別ルートは保護対象外", () => {
    expect(isProtectedAdminPath("/administrator")).toBe(false);
  });
});

describe("resolveAdminRedirect", () => {
  it("未認証で /admin/** にアクセスすると /admin/login へリダイレクト(callbackUrl 付き)", () => {
    const redirect = resolveAdminRedirect({
      isLoggedIn: false,
      pathname: "/admin/reservations",
      search: "?date=2026-07-16",
      origin: ORIGIN,
    });

    expect(redirect).not.toBeNull();
    expect(redirect?.pathname).toBe(LOGIN_PATH);
    expect(redirect?.searchParams.get("callbackUrl")).toBe(
      "/admin/reservations?date=2026-07-16",
    );
  });

  it("未認証でも /admin/login 自体はリダイレクトしない(素通し)", () => {
    const redirect = resolveAdminRedirect({
      isLoggedIn: false,
      pathname: "/admin/login",
      search: "",
      origin: ORIGIN,
    });

    expect(redirect).toBeNull();
  });

  it("認証済みで /admin/login にアクセスすると /admin へリダイレクト", () => {
    const redirect = resolveAdminRedirect({
      isLoggedIn: true,
      pathname: "/admin/login",
      search: "",
      origin: ORIGIN,
    });

    expect(redirect?.pathname).toBe(ADMIN_HOME_PATH);
  });

  it("認証済みで /admin/** にアクセスするとリダイレクトしない(素通し)", () => {
    const redirect = resolveAdminRedirect({
      isLoggedIn: true,
      pathname: "/admin/reservations",
      search: "",
      origin: ORIGIN,
    });

    expect(redirect).toBeNull();
  });
});
