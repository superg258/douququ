import { expect, test } from "playwright/test";

test("regional simulation restores semantic URL state and renders the shared canvas", async ({ page }) => {
  await page.goto(
    "/regions/south_region?view=playoff&mode=sim&seed=20260414&highlight=%E6%B7%B1%E5%9C%B3%E5%A4%A7%E5%AD%A6",
  );

  await expect(page.getByRole("heading", { name: /南部赛区/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "分享" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "导出 PNG" })).toBeEnabled();
  await expect(page).toHaveURL(/view=playoff/);
  await expect(page).toHaveURL(/mode=sim/);
  await expect(page).toHaveURL(/seed=20260414/);
  await expect(page.locator("text=主淘汰链").first()).toBeVisible();
});

test("finals simulation renders the selected fixed stage", async ({ page }) => {
  await page.goto("/forecast-center?event=nationals&stage=final-four&mode=sim&seed=20260414");

  await expect(page.getByText("四强与决赛", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "分享" })).toBeEnabled();
  await expect(page).toHaveURL(/event=nationals/);
  await expect(page).toHaveURL(/stage=final-four/);
});
