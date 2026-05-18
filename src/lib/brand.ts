const appIconModules = import.meta.glob("../assets/brand/app-icon.png", {
  eager: true,
  import: "default",
  query: "?url"
});

export const appIconUrl = (appIconModules["../assets/brand/app-icon.png"] as string | undefined) ?? "";

