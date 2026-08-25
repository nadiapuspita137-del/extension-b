export const PANEL_URLS = Object.freeze({
  WD: "https://bfj.porta-assist.com/_SubAg_Sub/WashCreditHistory.aspx",
  SCB: "https://bfj.porta-assist.com/_SubAg_Sub/AddCreditHistory2.aspx",
  DP: "https://bfj.porta-assist.com/_SubAg_Sub/AddCreditHistory2.aspx?IsABD=1"
});

export const PANEL_TYPES = Object.freeze(["DP", "WD", "SCB"]);
export const PANEL_TAB_PATTERN = "https://bfj.porta-assist.com/_SubAg_Sub/*";

export function configuredPageType(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.origin !== "https://bfj.porta-assist.com") return null;
    const path = url.pathname.toLocaleLowerCase("en-US");
    if (path.endsWith("/washcredithistory.aspx")) return "WD";
    if (!path.endsWith("/addcredithistory2.aspx")) return null;
    const isAbd = [...url.searchParams.entries()].some(
      ([key, value]) => key.toLocaleLowerCase("en-US") === "isabd" && value === "1"
    );
    return isAbd ? "DP" : "SCB";
  } catch {
    return null;
  }
}
